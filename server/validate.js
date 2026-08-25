/* What the model said, reduced to what the catalogue allows.
 *
 * The app's central claim is that a hallucinated document name cannot reach a
 * user's case, because the model answers with keys from a catalogue rather than
 * with prose. Until now the only thing enforcing that was the schema in the
 * request — which is fine when we are talking to Anthropic directly and the schema
 * is enforced by the same service that generates the tokens.
 *
 * Through a gateway it is no longer the same service. The request names a schema;
 * whether it was enforced, and how strictly, depends on which provider answered.
 * OpenAI-style strict mode also cannot express half of what our schema says —
 * lengths, ranges and item caps are dropped on the way out (see
 * adapters/openrouter.js) — so something has to re-apply them on the way back.
 *
 * So the guarantee is moved to where it cannot be routed around: here, on our own
 * side, after the answer arrives and before anything is returned. A document whose
 * key is not in the catalogue is dropped, not renamed and not guessed at. Missing
 * beats wrong — the same rule the prompt states, enforced rather than requested.
 *
 * Everything dropped is counted and returned, because "the model named three
 * documents that do not exist" is exactly the signal the evaluation set is for.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const str = (v, max) => {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
};

const num01 = v => (typeof v === 'number' && Number.isFinite(v))
  ? Math.min(1, Math.max(0, v))
  : 0;

/* A date that is not a real calendar date is worse than no date: the client writes
   it straight onto the case as a deadline. "אל תמציא תאריך" applies to us too. */
const isoDate = v => {
  const s = str(v, 10);
  if (!s || !ISO_DATE.test(s)) return null;
  const d = new Date(s + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
};

/* The identify pass answers with a free-text agency — its schema has no enum,
   because it runs before we have decided anything. An agency outside the catalogue
   is still not something we can use, and it feeds the form signature. */
export function validateIdentify(parsed, catalogue) {
  const p = parsed && typeof parsed === 'object' ? parsed : {};
  return {
    is_letter: p.is_letter === true,
    agency: (typeof p.agency === 'string' && p.agency in catalogue.agencies) ? p.agency : null,
    form_code: str(p.form_code, 40),
    form_title_he: str(p.form_title_he, 120),
    personalised: p.personalised === true
  };
}

export function validateAnalysis(parsed, catalogue) {
  const p = parsed && typeof parsed === 'object' ? parsed : {};
  const dropped = { docs: 0, extra: 0, dates: 0 };

  const seen = new Set();
  const required_docs = [];
  for (const d of Array.isArray(p.required_docs) ? p.required_docs : []) {
    const key = d && typeof d.key === 'string' ? d.key : null;
    const evidence = str(d && d.evidence, 200);
    /* No key in the catalogue, or no quote from the letter, means we cannot show
       the user why this document is on their list. Rule 2 of the prompt, applied. */
    if (!key || !(key in catalogue.docs) || !evidence || seen.has(key)) { dropped.docs++; continue; }
    seen.add(key);
    required_docs.push({ key, evidence, confidence: num01(d.confidence) });
    if (required_docs.length === 20) break;
  }

  /* An extra_doc is free text by definition, so the only checks available are that
     it says something and that it is not already on the list under its own key. */
  const extraSeen = new Set(required_docs.map(d => catalogue.docs[d.key] && catalogue.docs[d.key].he).filter(Boolean));
  const extra_docs = [];
  for (const d of Array.isArray(p.extra_docs) ? p.extra_docs : []) {
    const he = str(d && d.he, 80);
    const evidence = str(d && d.evidence, 200);
    if (!he || !evidence || extraSeen.has(he)) { dropped.extra++; continue; }
    extraSeen.add(he);
    extra_docs.push({ he, evidence, confidence: num01(d.confidence) });
    if (extra_docs.length === 10) break;
  }

  const deadline = isoDate(p.deadline);
  const letter_date = isoDate(p.letter_date);
  if (p.deadline && !deadline) dropped.dates++;
  if (p.letter_date && !letter_date) dropped.dates++;

  const where = p.form_to_fill && ['self', 'separate', 'none'].includes(p.form_to_fill.where)
    ? p.form_to_fill.where : 'none';

  const result = {
    agency: (typeof p.agency === 'string' && p.agency in catalogue.agencies) ? p.agency : null,
    agency_child: str(p.agency_child, 80),
    template: (typeof p.template === 'string' && p.template in catalogue.templates) ? p.template : null,
    required_docs,
    extra_docs,
    deadline,
    letter_date,
    /* Character for character or not at all — a wrong case number is worse than a
       missing one, so it is clamped but never rewritten. */
    reference: str(p.reference, 60),
    form_code: str(p.form_code, 40),
    form_title_he: str(p.form_title_he, 120),
    form_to_fill: {
      where,
      form_code: where === 'none' ? null : str(p.form_to_fill && p.form_to_fill.form_code, 40),
      form_title_he: where === 'none' ? null : str(p.form_to_fill && p.form_to_fill.form_title_he, 120)
    },
    personalised: p.personalised === true,
    confidence: num01(p.confidence),
    language: ['he', 'en', 'fr', 'ru', 'ar', 'other'].includes(p.language) ? p.language : 'other'
  };

  return { result, dropped, droppedTotal: dropped.docs + dropped.extra + dropped.dates };
}
