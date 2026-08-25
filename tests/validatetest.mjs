/* The catalogue check, tested against the answers a model actually gives when the
 * schema was not enforced as tightly as the request asked.
 *
 * These are not hypotheticals dressed up as tests. Every case here is a way an
 * answer can be well-formed JSON and still be something that must not reach a
 * user's case: an invented document key, a document with no quote behind it, a
 * deadline that is not a date. The point of the module is that the app's central
 * promise survives a provider that shrugged at the schema.
 */
import { validateAnalysis, validateIdentify } from '../server/validate.js';
import { createAnalyzer } from '../server/analyze.js';
import { readFileSync } from 'node:fs';

const catalogue = JSON.parse(readFileSync(new URL('../contracts/catalogue.json', import.meta.url).pathname, 'utf8'));
let pass = 0, fail = 0;
const ok = (m, c) => { c ? (pass++, console.log('PASS  ' + m)) : (fail++, console.log('FAIL  ' + m)); };

const GOOD = {
  agency: 'btl', agency_child: null, template: 'child_allowance',
  required_docs: [{ key: 'teudat_zehut', evidence: 'צילום תעודת זהות', confidence: 0.9 }],
  extra_docs: [{ he: 'תעודת לידה מתורגמת', evidence: 'יש לצרף תעודת לידה', confidence: 0.7 }],
  deadline: '2026-09-30', letter_date: '2026-08-02', reference: '304-882-1177',
  form_code: 'בל/5020', form_title_he: 'בקשה לקצבת ילדים',
  form_to_fill: { where: 'self', form_code: 'בל/5020', form_title_he: 'בקשה לקצבת ילדים' },
  personalised: false, confidence: 0.91, language: 'he'
};
const v = p => validateAnalysis({ ...GOOD, ...p }, catalogue);

/* ---- a good answer passes through unchanged ---- */
const clean = v({});
ok('a valid answer keeps its documents', clean.result.required_docs.length === 1);
ok('a valid answer keeps its extras', clean.result.extra_docs.length === 1);
ok('a valid answer drops nothing', clean.droppedTotal === 0);
ok('the reference is copied character for character', clean.result.reference === '304-882-1177');
ok('the deadline survives', clean.result.deadline === '2026-09-30');

/* ---- the promise: no invented document reaches a case ---- */
const invented = v({ required_docs: [
  { key: 'teudat_zehut', evidence: 'צילום תעודת זהות', confidence: 0.9 },
  { key: 'certificate_of_good_vibes', evidence: 'נדרש אישור', confidence: 0.99 }
] });
ok('a document outside the catalogue is dropped', invented.result.required_docs.length === 1);
ok('the surviving document is the real one', invented.result.required_docs[0].key === 'teudat_zehut');
ok('the drop is counted', invented.dropped.docs === 1);
ok('confidence does not buy a key into the catalogue',
  !JSON.stringify(invented.result).includes('good_vibes'));

/* Rule 2 of the prompt: if it cannot be quoted, it is not on the list. Enforced
   here rather than merely asked for. */
ok('a document with no quote behind it is dropped',
  v({ required_docs: [{ key: 'passport', evidence: '', confidence: 0.9 }] }).result.required_docs.length === 0);
ok('a document with no quote at all is dropped',
  v({ required_docs: [{ key: 'passport', confidence: 0.9 }] }).result.required_docs.length === 0);

ok('the same document twice appears once',
  v({ required_docs: [
    { key: 'passport', evidence: 'דרכון', confidence: 0.9 },
    { key: 'passport', evidence: 'דרכון בתוקף', confidence: 0.8 }
  ] }).result.required_docs.length === 1);

ok('an invented agency becomes null', v({ agency: 'ministry_of_nothing' }).result.agency === null);
ok('an invented process becomes null', v({ template: 'no_such_process' }).result.template === null);
ok('a real agency is kept', v({ agency: 'rashut' }).result.agency === 'rashut');

/* ---- dates: a wrong one is worse than none, because the client writes it on ---- */
ok('a prose deadline is refused', v({ deadline: 'תוך 30 יום' }).result.deadline === null);
ok('a date that is not a date is refused', v({ deadline: '2026-13-45' }).result.deadline === null);
ok('the 31st of February is refused', v({ deadline: '2026-02-31' }).result.deadline === null);
ok('a refused date is counted', v({ deadline: 'בקרוב' }).dropped.dates === 1);
ok('a leap day is a real date', v({ deadline: '2028-02-29' }).result.deadline === '2028-02-29');

/* ---- ranges and lengths, re-applied after strict mode dropped them ---- */
ok('confidence above one is clamped', v({ confidence: 7 }).result.confidence === 1);
ok('negative confidence is clamped', v({ confidence: -3 }).result.confidence === 0);
ok('confidence that is not a number is zero, not undefined',
  v({ confidence: 'high' }).result.confidence === 0);
ok('an overlong reference is cut, not dropped',
  v({ reference: 'x'.repeat(200) }).result.reference.length === 60);
ok('more documents than the cap are cut',
  validateAnalysis({ ...GOOD, required_docs: Array.from({ length: 40 }, () => (
    { key: 'passport', evidence: 'דרכון', confidence: 0.5 })) }, catalogue).result.required_docs.length <= 20);

/* ---- shapes that would throw if they were trusted ---- */
ok('a missing required_docs array is an empty list', v({ required_docs: undefined }).result.required_docs.length === 0);
ok('required_docs as a string is an empty list', v({ required_docs: 'none' }).result.required_docs.length === 0);
ok('a null answer does not throw', validateAnalysis(null, catalogue).result.confidence === 0);
ok('a missing form_to_fill becomes "none"', v({ form_to_fill: undefined }).result.form_to_fill.where === 'none');
ok('an unknown where becomes "none"',
  v({ form_to_fill: { where: 'maybe' } }).result.form_to_fill.where === 'none');
ok('nothing to fill carries no form code',
  v({ form_to_fill: { where: 'none', form_code: 'בל/5020' } }).result.form_to_fill.form_code === null);
ok('an unknown language becomes "other"', v({ language: 'klingon' }).result.language === 'other');
ok('personalised is a boolean, never a string', v({ personalised: 'yes' }).result.personalised === false);

/* ---- the extras, which are free text by definition ---- */
ok('an extra with no quote is dropped',
  v({ extra_docs: [{ he: 'משהו', evidence: '' }] }).result.extra_docs.length === 0);
ok('an extra repeating a catalogue document it already listed is dropped',
  v({ required_docs: [{ key: 'passport', evidence: 'דרכון', confidence: 0.9 }],
      extra_docs: [{ he: catalogue.docs.passport.he, evidence: 'יש לצרף דרכון', confidence: 0.6 }]
    }).result.extra_docs.length === 0);

/* ---- identify, whose schema has no enum to lean on ---- */
ok('identify keeps a catalogue agency',
  validateIdentify({ is_letter: true, agency: 'btl' }, catalogue).agency === 'btl');
ok('identify drops an agency it invented',
  validateIdentify({ is_letter: true, agency: 'btl_north_branch' }, catalogue).agency === null);
ok('is_letter is a boolean, never a truthy string',
  validateIdentify({ is_letter: 'yes' }, catalogue).is_letter === false);
ok('identify on nothing does not throw',
  validateIdentify(undefined, catalogue).is_letter === false);

/* ---- and the whole pipeline, with a provider that answered badly ---- */
const badProvider = {
  name: 'bad',
  models: { identify: 'x', read: 'y', escalate: 'z' },
  identify: async () => ({ parsed: { is_letter: true, agency: 'btl', form_code: 'A', form_title_he: 'B' },
                           usage: {}, model: 'x' }),
  read: async () => ({ parsed: { ...GOOD, deadline: 'שבועיים', required_docs: [
    { key: 'teudat_zehut', evidence: 'צילום תעודת זהות', confidence: 0.9 },
    { key: 'invented_key', evidence: 'נדרש', confidence: 0.99 }
  ] }, usage: {}, model: 'y' }),
  escalate: async () => { throw new Error('not reached'); },
  costOf: () => 0
};
const out = await createAnalyzer({ adapter: badProvider, catalogue })({ image: 'A', mediaType: 'image/jpeg' });
ok('the pipeline returns only catalogue keys', out.result.required_docs.every(d => d.key in catalogue.docs));
ok('the pipeline refused the prose deadline', out.result.deadline === null);
ok('the pipeline reports what it dropped', out.meta.dropped === 2);
ok('the user is still charged for a usable read', out.credits === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
