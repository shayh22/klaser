/* What the model said, made safe to use — without narrowing what it may say.
 *
 * This file used to be a filter. A document whose key was not in the catalogue was
 * dropped, and an agency outside the nine was turned into null. That made an
 * invented document name impossible, and it also made קרנית impossible, and a
 * private landlord, a management company, a fund nobody had enumerated. For a
 * product whose whole purpose is bureaucracy nobody has enumerated for you, that
 * was the wrong trade.
 *
 * So the vocabulary is open now. A document names a catalogue key when one fits and
 * carries its Hebrew name always; when no key fits, the Hebrew name alone is a
 * perfectly good document. The catalogue's job is translation — a key renders in
 * four languages, a free name renders in the one it was written in — not permission.
 *
 * What still holds the line is evidence. A document that cannot be quoted from the
 * letter does not go on the list, whatever it is called. That is the rule that
 * separates a list read off the page from a list guessed from the subject, and it
 * is the one worth enforcing rather than merely asking for. Dates are still checked
 * for being dates, because the client writes a deadline straight onto the case.
 *
 * Everything dropped is still counted and returned. The number means something
 * different now — it is no longer "the model used a word we do not know", it is
 * "the model listed something it could not point at".
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

/* Everything the user may be referred to by key: the shared catalogue plus whatever
   this user has added for themselves. A key from either renders in four languages;
   anything else is kept by name. */
function vocabulary(catalogue, extras) {
  const agencies = new Map(Object.entries(catalogue.agencies).map(([k, v]) => [k, v.he]));
  const docs = new Map(Object.entries(catalogue.docs).map(([k, v]) => [k, v.he]));
  for (const a of extras?.agencies || []) agencies.set(a.key, a.he);
  for (const d of extras?.docs || []) docs.set(d.key, d.he);
  return { agencies, docs };
}

export function validateIdentify(parsed, catalogue, extras) {
  const p = parsed && typeof parsed === 'object' ? parsed : {};
  const vocab = vocabulary(catalogue, extras);
  return {
    is_letter: p.is_letter === true,
    agency: (typeof p.agency === 'string' && vocab.agencies.has(p.agency)) ? p.agency : null,
    /* Kept whether or not a key matched. It is what the form signature hashes when
       there is no key, and what the client offers to save as a new agency. */
    agency_he: str(p.agency_he, 80),
    form_code: str(p.form_code, 40),
    form_title_he: str(p.form_title_he, 120),
    personalised: p.personalised === true
  };
}

export function validateAnalysis(parsed, catalogue, extras) {
  const p = parsed && typeof parsed === 'object' ? parsed : {};
  const vocab = vocabulary(catalogue, extras);
  const dropped = { unquoted: 0, unnamed: 0, dates: 0 };

  /* Accepts the older two-array shape as well, so a fixture or a cached answer from
     before the vocabulary opened up still reads. extra_docs was only ever "required
     documents we had no key for", which is now just a document with key: null. */
  const incoming = [
    ...(Array.isArray(p.required_docs) ? p.required_docs : []),
    ...(Array.isArray(p.extra_docs) ? p.extra_docs : [])
  ];

  const seen = new Set();
  const required_docs = [];
  for (const d of incoming) {
    if (!d || typeof d !== 'object') { dropped.unnamed++; continue; }

    const rawKey = typeof d.key === 'string' ? d.key : null;
    /* A key we recognise renders in four languages. One we do not is not a reason to
       discard the document — it is a reason to fall back to its Hebrew name, which
       is exactly what a document with no key does. */
    const key = rawKey && vocab.docs.has(rawKey) ? rawKey : null;
    /* The letter's own wording first, the catalogue's name as a fallback. A model
       that returned a key and no name still yields something renderable. */
    const he = str(d.he, 80) || (key ? vocab.docs.get(key) : null);
    const evidence = str(d.evidence, 200);

    /* The line that actually holds. Without a quote from the letter there is no way
       to show the user why this is on their list, and no way to tell a reading from
       a guess. Rule 2 of the prompt, enforced rather than requested. */
    if (!evidence) { dropped.unquoted++; continue; }
    /* Neither a key we know nor a name to show: nothing renderable. */
    if (!key && !he) { dropped.unnamed++; continue; }

    const dedupe = key || he;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    required_docs.push({ key, he, evidence, confidence: num01(d.confidence) });
    if (required_docs.length === 25) break;
  }

  const deadline = isoDate(p.deadline);
  const letter_date = isoDate(p.letter_date);
  if (p.deadline && !deadline) dropped.dates++;
  if (p.letter_date && !letter_date) dropped.dates++;

  const where = p.form_to_fill && ['self', 'separate', 'none'].includes(p.form_to_fill.where)
    ? p.form_to_fill.where : 'none';

  const agencyKey = (typeof p.agency === 'string' && vocab.agencies.has(p.agency)) ? p.agency : null;

  const result = {
    agency: agencyKey,
    /* The name is kept even when a key matched — the letter may call ביטוח לאומי
       "סניף חיפה" and that is worth showing. When no key matched it is the only
       thing standing between the user and a case filed under "other". */
    agency_he: str(p.agency_he, 80),
    agency_child: str(p.agency_child, 80),
    template: (typeof p.template === 'string' && p.template in catalogue.templates) ? p.template : null,
    required_docs,
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

  return { result, dropped, droppedTotal: dropped.unquoted + dropped.unnamed + dropped.dates };
}

/* What the client is allowed to send as its own vocabulary.
 *
 * Bounded on every axis, because this text is pasted into a prompt: a key that is
 * not a plain identifier, or a name long enough to be a paragraph, is somebody
 * trying to write instructions rather than name their landlord. Names are kept as
 * written otherwise — they are the user's own words about their own document. */
const KEY_OK = /^[a-z0-9_]{1,40}$/i;
const LIMITS = { agencies: 60, docs: 250 };

export function sanitiseExtras(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const field of ['agencies', 'docs']) {
    const list = Array.isArray(raw[field]) ? raw[field] : [];
    const seen = new Set();
    const kept = [];
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const key = typeof item.key === 'string' && KEY_OK.test(item.key) ? item.key : null;
      /* Newlines are the thing to remove: a name is a name, and a name containing
         its own line breaks is trying to become a new paragraph of the prompt. */
      const he = str(typeof item.he === 'string' ? item.he.replace(/\s+/g, ' ') : null, 80);
      if (!key || !he || seen.has(key)) continue;
      seen.add(key);
      kept.push({ key, he });
      if (kept.length === LIMITS[field]) break;
    }
    if (kept.length) out[field] = kept;
  }
  return (out.agencies || out.docs) ? out : null;
}
