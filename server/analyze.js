/* The analyse pipeline.
 *
 *   identify (cheap)  ->  is this a letter at all?
 *                     ->  which form is it?  (form signature)
 *   catalogue lookup  ->  hit: serve a stored checklist, charge nothing
 *   read (expensive)  ->  miss: read the letter in full, charge one credit
 *
 * The catalogue layer is P3 on the roadmap, so `lookup` is injectable and defaults to
 * always missing. The branch exists now because retrofitting a free path into a paid
 * one later is harder than leaving the door open.
 */

import { ApiError } from './errors.js';
import { identifySystem, readSystem, catalogueBlock, extrasBlock, analysisSchema, IDENTIFY_SCHEMA } from './prompts.js';
import { validateAnalysis, validateIdentify } from './validate.js';

/* Which model each stage costs against, when the adapter does not say. An adapter
   that routes through a gateway names its own slugs (adapters/openrouter.js), so
   asking it first is what stops the spend cap being priced against a model nobody
   called. */
const DEFAULT_MODEL_NAMES = {
  identify: 'claude-haiku-4-5',
  read:     'claude-sonnet-5',
  escalate: 'claude-opus-5'
};

const CONFIDENCE_FLOOR = 0.45;   /* below this nothing is proposed at all */
const ESCALATE_BELOW   = 0.6;    /* below this, try the stronger model once */

/* Impersonal by construction: agency + form code + normalised title. No recipient,
   no reference number, no date.
   Falls back to the agency's Hebrew name when no catalogue key matched, so a body
   nobody has enumerated still gets a stable signature rather than sharing "?" with
   every other unlisted body. */
export async function formSignature({ agency, agency_he, form_code, form_title_he }) {
  const norm = s => (s || '').replace(/[\s‏‎"'׳״.,:;()\-–—]/g, '').slice(0, 60);
  const basis = `${agency || norm(agency_he) || '?'}|${norm(form_code)}|${norm(form_title_he)}`;
  const bytes = new TextEncoder().encode(basis);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}

const NOT_A_LETTER = {
  agency: null, agency_he: null, agency_child: null, template: null,
  required_docs: [],
  deadline: null, letter_date: null, reference: null,
  form_code: null, form_title_he: null,
  form_to_fill: { where: 'none', form_code: null, form_title_he: null },
  personalised: false, confidence: 0, language: 'he', not_a_letter: true
};

export function createAnalyzer({ adapter, catalogue, lookup = async () => null }) {
  /* Built once: byte-identical on every request, which is what lets it carry the
     cache breakpoint. The user's own vocabulary is deliberately NOT in here — it
     varies per person, and folding it in would cost everyone the cache. */
  const cachedPrefix = catalogueBlock(catalogue);

  return async function analyze({ image, mediaType, hint, extras }) {
    /* The schema does vary per request, because a name this user saved last week is
       a key the model may answer with today. Schemas are not cached, so this is
       free. */
    const schema = analysisSchema(catalogue, extras);
    const userVocab = extrasBlock(extras);
    const started = Date.now();
    const usageTotal = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0 };
    let costUsd = 0;

    /* `model` is what we asked for, not what came back — a gateway may answer on a
       different revision of the same slug, and the price table is keyed by what we
       requested. An adapter that knows the real charge reports it in usage.cost and
       costOf returns that instead of estimating. */
    const track = (r, model) => {
      usageTotal.input_tokens  += r.usage.input_tokens || 0;
      usageTotal.output_tokens += r.usage.output_tokens || 0;
      usageTotal.cache_read_tokens += r.usage.cache_read_input_tokens || 0;
      costUsd += adapter.costOf(model, r.usage);
    };
    const modelFor = stage => (adapter.models && adapter.models[stage]) || DEFAULT_MODEL_NAMES[stage];

    /* --- 1. identify ------------------------------------------------------- */
    let ident;
    try {
      ident = await adapter.identify({
        system: identifySystem(),
        cachedPrefix,
        image, mediaType,
        instruction: withVocab('זהה את המסמך המצורף.', userVocab),
        schema: IDENTIFY_SCHEMA
      });
    } catch (e) {
      throw new ApiError('upstream_error', { detail: e.message, cause: e });
    }
    track(ident, modelFor('identify'));
    ident.parsed = validateIdentify(ident.parsed, catalogue, extras);

    if (!ident.parsed.is_letter) {
      return {
        result: NOT_A_LETTER,
        meta: { source: 'model', credits_charged: 0, form_signature: null,
                model: ident.model, escalated: false,
                latency_ms: Date.now() - started, ...usageTotal },
        costUsd
      };
    }

    const signature = await formSignature(ident.parsed);

    /* --- 2. catalogue ------------------------------------------------------ */
    const hit = await lookup(signature);
    if (hit) {
      return {
        result: { ...hit, form_code: ident.parsed.form_code, form_title_he: ident.parsed.form_title_he },
        meta: { source: 'catalogue', credits_charged: 0, form_signature: signature,
                model: ident.model, escalated: false,
                latency_ms: Date.now() - started, ...usageTotal },
        costUsd
      };
    }

    /* There is deliberately no "the title looks like a known process" shortcut here.
       Matching a template by name and serving its checklist without reading looked
       like a free layer-0 hit, but it throws away the two things only this letter
       carries — the deadline and the אסמכתא — and a loose title match would serve a
       confidently wrong checklist for free. Layer 0 is the user picking a process in
       the app, which never reaches this endpoint at all. */

    /* --- 3. read ----------------------------------------------------------- */
    let read;
    try {
      read = await adapter.read({
        system: readSystem(),
        cachedPrefix,
        image, mediaType,
        instruction: withVocab(instructionFor(hint), userVocab),
        schema
      });
    } catch (e) {
      throw new ApiError('upstream_error', { detail: e.message, cause: e });
    }
    track(read, modelFor('read'));
    /* Validated before its confidence is compared with anything, so the comparison
       is between two answers that have both already lost whatever the catalogue
       does not recognise. Otherwise a confident answer full of invented keys wins
       against a modest one that was right. */
    let checked = validateAnalysis(read.parsed, catalogue, extras);
    let usedModel = read.model;

    let escalated = false;
    if (checked.result.confidence < ESCALATE_BELOW) {
      try {
        const up = await adapter.escalate({
          system: readSystem(), cachedPrefix, image, mediaType,
          instruction: withVocab(instructionFor(hint), userVocab), schema
        });
        track(up, modelFor('escalate'));
        const upChecked = validateAnalysis(up.parsed, catalogue, extras);
        if (upChecked.result.confidence > checked.result.confidence) {
          checked = upChecked; usedModel = up.model; escalated = true;
        }
      } catch { /* escalation is best-effort; the first answer still stands */ }
    }

    const result = checked.result;
    if (result.confidence < CONFIDENCE_FLOOR) result.required_docs = [];

    /* Charged only for a read that produced something the user can act on, which
       means a confident answer AND at least one document proposed. Confidence alone
       was the wrong test: a blank claim form reads perfectly — high confidence, real
       agency, real form code — and yields no checklist at all, because there is no
       checklist in it. Billing a credit for that is billing for an empty list, which
       is the opposite of "failed reads cost nothing".
       The same argument covers the unreadable photo it was already written for. */
    const proposed = result.required_docs.length;
    const usable = result.confidence >= CONFIDENCE_FLOOR && proposed > 0;
    return {
      result,
      credits: usable ? 1 : 0,
      meta: { source: 'model', credits_charged: usable ? 1 : 0,
              form_signature: signature, model: usedModel, escalated,
              /* How much of the answer the catalogue refused. Zero is the normal
                 case; anything else is the number the evaluation set exists to
                 watch, so it is counted even though nobody acts on it yet. */
              dropped: checked.droppedTotal,
              latency_ms: Date.now() - started, ...usageTotal },
      costUsd
    };
  };
}

/* The user's own names ride with the instruction rather than with the catalogue,
   so the shared block stays byte-identical and keeps its cache. */
function withVocab(instruction, userVocab) {
  return userVocab ? `${userVocab}\n\n${instruction}` : instruction;
}

function instructionFor(hint) {
  let s = 'קרא את המסמך המצורף והחזר את רשימת המסמכים שצריך לאסוף.';
  if (hint && hint.agency)   s += `\nהמשתמש פתח את זה מתוך תיק מול: ${hint.agency}. אם המכתב סותר — לך אחרי המכתב.`;
  if (hint && hint.template) s += `\nהתיק שייך לתהליך: ${hint.template}.`;
  return s;
}
