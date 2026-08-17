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
import { identifySystem, readSystem, catalogueBlock, analysisSchema, IDENTIFY_SCHEMA } from './prompts.js';

const CONFIDENCE_FLOOR = 0.45;   /* below this nothing is proposed at all */
const ESCALATE_BELOW   = 0.6;    /* below this, try the stronger model once */

/* Impersonal by construction: agency + form code + normalised title. No recipient,
   no reference number, no date. */
export async function formSignature({ agency, form_code, form_title_he }) {
  const norm = s => (s || '').replace(/[\s‏‎"'׳״.,:;()\-–—]/g, '').slice(0, 60);
  const basis = `${agency || '?'}|${norm(form_code)}|${norm(form_title_he)}`;
  const bytes = new TextEncoder().encode(basis);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}

const NOT_A_LETTER = {
  agency: null, agency_child: null, template: null,
  required_docs: [], extra_docs: [],
  deadline: null, letter_date: null, reference: null,
  form_code: null, form_title_he: null,
  form_to_fill: { where: 'none', form_code: null, form_title_he: null },
  personalised: false, confidence: 0, language: 'he', not_a_letter: true
};

export function createAnalyzer({ adapter, catalogue, lookup = async () => null }) {
  const cachedPrefix = catalogueBlock(catalogue);
  const schema = analysisSchema(catalogue);

  return async function analyze({ image, mediaType, hint }) {
    const started = Date.now();
    const usageTotal = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0 };
    let costUsd = 0;

    const track = (r, model) => {
      usageTotal.input_tokens  += r.usage.input_tokens || 0;
      usageTotal.output_tokens += r.usage.output_tokens || 0;
      usageTotal.cache_read_tokens += r.usage.cache_read_input_tokens || 0;
      costUsd += adapter.costOf(model, r.usage);
    };

    /* --- 1. identify ------------------------------------------------------- */
    let ident;
    try {
      ident = await adapter.identify({
        system: identifySystem(),
        cachedPrefix,
        image, mediaType,
        instruction: 'זהה את המסמך המצורף.',
        schema: IDENTIFY_SCHEMA
      });
    } catch (e) {
      throw new ApiError('upstream_error', { detail: e.message });
    }
    track(ident, 'claude-haiku-4-5');

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
        instruction: instructionFor(hint),
        schema
      });
    } catch (e) {
      throw new ApiError('upstream_error', { detail: e.message });
    }
    track(read, 'claude-sonnet-5');

    let escalated = false;
    if ((read.parsed.confidence ?? 0) < ESCALATE_BELOW) {
      try {
        const up = await adapter.escalate({
          system: readSystem(), cachedPrefix, image, mediaType,
          instruction: instructionFor(hint), schema
        });
        track(up, 'claude-opus-5');
        if ((up.parsed.confidence ?? 0) > (read.parsed.confidence ?? 0)) { read = up; escalated = true; }
      } catch { /* escalation is best-effort; the first answer still stands */ }
    }

    const result = read.parsed;
    if ((result.confidence ?? 0) < CONFIDENCE_FLOOR) {
      result.required_docs = [];
      result.extra_docs = [];
    }

    return {
      result,
      /* Charged only for a read that produced something usable. An unreadable photo
         cost us money and the user nothing useful, so they are not billed for it. */
      credits: (result.confidence ?? 0) >= CONFIDENCE_FLOOR ? 1 : 0,
      meta: { source: 'model', credits_charged: (result.confidence ?? 0) >= CONFIDENCE_FLOOR ? 1 : 0,
              form_signature: signature, model: read.model, escalated,
              latency_ms: Date.now() - started, ...usageTotal },
      costUsd
    };
  };
}

function instructionFor(hint) {
  let s = 'קרא את המסמך המצורף והחזר את רשימת המסמכים שצריך לאסוף.';
  if (hint && hint.agency)   s += `\nהמשתמש פתח את זה מתוך תיק מול: ${hint.agency}. אם המכתב סותר — לך אחרי המכתב.`;
  if (hint && hint.template) s += `\nהתיק שייך לתהליך: ${hint.template}.`;
  return s;
}
