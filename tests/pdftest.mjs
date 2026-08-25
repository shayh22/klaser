/* A real document, through the whole thing.
 *
 * The fixture is a genuine three-page Hebrew claim form for קרנית — the fund that
 * pays road-accident victims when the driver was uninsured, hit and ran, or had no
 * licence. It was produced by Word, so it is born-digital text rather than a
 * photograph, which is how a lot of letters actually arrive: forwarded from the
 * agency, not photographed off paper.
 *
 * It was chosen because it is the case the pipeline is most likely to get wrong in
 * the most expensive direction. It is a **blank form**, so the correct answer is
 * almost nothing: section 7 is headed מסמכים מצורפים and then stops, because the
 * list of attachments is for the claimant to write, not for the fund to state. A
 * model that pattern-matches "road accident claim" and helpfully proposes a police
 * report, a medical certificate and an ID is confidently wrong, and it is wrong on
 * somebody's compensation claim.
 *
 * And קרנית is not in the catalogue. Nine agencies are; this is not one of them.
 * So the right behaviour is to file the case under "other" rather than under a
 * plausible-looking neighbour.
 *
 * What is real here: the file, its bytes, the client, the Worker, the OpenRouter
 * adapter, the request it builds, the catalogue check, the review sheet and the
 * case. What is stubbed is the gateway's answer — this container cannot reach
 * openrouter.ai, and a test that depended on a live model would not be a test.
 */
import { chromium } from './browser.mjs';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createApp } from '../server/index.js';
import { createOpenRouterAdapter } from '../server/adapters/openrouter.js';

const APP = 'http://127.0.0.1:8099/index.html';
const PORT = 8794;
const API = 'http://127.0.0.1:' + PORT;
const HERE = new URL('.', import.meta.url).pathname;
const ROOT = new URL('..', import.meta.url).pathname;
const catalogue = JSON.parse(readFileSync(ROOT + 'contracts/catalogue.json', 'utf8'));
const PDF = HERE + 'karnit-form.pdf';
const bytes = readFileSync(PDF);

let pass = 0, fail = 0;
const ok = (m, c) => { c ? (pass++, console.log('PASS  ' + m)) : (fail++, console.log('FAIL  ' + m)); };

/* ---- the file itself, before anything touches it ---- */
ok('the fixture is a PDF', bytes.slice(0, 5).toString() === '%PDF-');
ok('it is the real thing, not a stub', bytes.length > 100 * 1024);
/* base64 inflates by 4/3, and the service caps the *decoded* size at 4MB */
const b64 = bytes.toString('base64');
ok('it fits under the service limit once base64-encoded', b64.length * 0.75 <= 4 * 1024 * 1024);
ok('and it is big enough to matter — a photo of this would not fit as easily',
  b64.length > 200 * 1024);

/* ---- the answer a correct model gives for a blank form ----
   High confidence, right form, and no checklist, because there is no checklist in
   the document. קרנית is named as the agency, which the catalogue does not have. */
const IDENT = { is_letter: true, agency: 'karnit', form_code: null,
                form_title_he: 'טופס תביעה', personalised: false };
const BLANK_FORM = {
  agency: 'karnit', agency_child: null, template: null,
  required_docs: [], extra_docs: [],
  deadline: null, letter_date: null, reference: null,
  form_code: null, form_title_he: 'טופס תביעה',
  form_to_fill: { where: 'self', form_code: null, form_title_he: 'טופס תביעה' },
  personalised: false, confidence: 0.93, language: 'he'
};

/* The way this goes wrong: the same document, read by a model that pattern-matched
   the subject instead of the text, and invented quotes to go with it. */
const HELPFUL_HALLUCINATION = {
  ...BLANK_FORM,
  agency: 'btl',
  required_docs: [
    { key: 'teudat_zehut', evidence: 'יש לצרף צילום תעודת זהות', confidence: 0.88 },
    { key: 'police_report_2311', evidence: 'יש לצרף אישור משטרה', confidence: 0.91 },
    { key: 'medical_certificate_x', evidence: 'יש לצרף תעודה רפואית', confidence: 0.86 }
  ],
  extra_docs: [{ he: 'חוות דעת רפואית', evidence: '', confidence: 0.7 }],
  deadline: 'תוך שנתיים מיום התאונה'
};

let answer = BLANK_FORM;
const upstream = [];
const gateway = async (url, opts) => {
  const body = JSON.parse(opts.body);
  upstream.push(body);
  const isIdentify = body.model.includes('haiku');
  return {
    ok: true,
    json: async () => ({
      model: body.model,
      choices: [{ message: { content: JSON.stringify(isIdentify ? IDENT : answer) } }],
      usage: { prompt_tokens: 9000, completion_tokens: 300,
               prompt_tokens_details: { cached_tokens: 1600 }, cost: 0.0271 }
    })
  };
};

const app = createApp({
  catalogue,
  adapter: createOpenRouterAdapter({ apiKey: 'sk-or-test', fetchImpl: gateway }),
  env: { FREE_CREDITS: '10' }
});

const srv = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const request = new Request(API + req.url, {
    method: req.method, headers: req.headers,
    body: (req.method === 'GET' || req.method === 'HEAD') ? undefined : Buffer.concat(chunks)
  });
  const out = await app(request);
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(Buffer.from(await out.arrayBuffer()));
});
await new Promise(r => srv.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch();
const errors = [];
async function freshPage() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });
  await page.addInitScript(e => { window.KLASER_AI_ENDPOINT = e; }, API);
  await page.goto(APP, { waitUntil: 'load' });
  await page.waitForTimeout(250);
  return page;
}

async function scan(page) {
  await page.setInputFiles('#letterInput', PDF);
  await page.waitForTimeout(300);
  if (await page.isVisible('#aiModal .sheet')) {
    const label = await page.textContent('#aiActions button:nth-child(1)');
    if (!/סגור|Close/i.test(label)) await page.click('#aiActions button:nth-child(1)');   // consent
  }
  await page.waitForFunction(() => {
    const b = document.querySelector('#aiBody');
    return b && !b.textContent.includes('קורא');
  }, null, { timeout: 15000 });
  await page.waitForTimeout(200);
}

/* ================= 1. the blank form, read correctly ================= */
let page = await freshPage();
await scan(page);

ok('the whole 3-page PDF reached the service', upstream.length === 2);
const req = upstream[1];
const part = req.messages[1].content[0];
ok('the PDF went as a file part, not an image', part.type === 'file');
ok('the bytes on the wire are the bytes on disk',
  part.file.file_data === 'data:application/pdf;base64,' + b64);
ok('the file-parser plugin was named, so the document is not dropped',
  req.plugins && req.plugins[0].id === 'file-parser');
ok('the filename keeps the extension the parser reads', part.file.filename.endsWith('.pdf'));

const body1 = await page.textContent('#aiBody');
ok('the review says there is nothing to collect', body1.includes('לא נמצאו מסמכים לאסוף'));
ok('and offers nothing to tick', (await page.$$('#aiBody [data-pick]')).length === 0);

/* The point of the exercise. A blank form reads perfectly — high confidence, right
   form, real agency — and yields no checklist, because there is no checklist in it.
   Billing a credit for that is billing for an empty list. The quota the client holds
   is the one the service just returned, so this is the real number. */
const quota = await page.evaluate(() => AI.quota);
ok('the service reported a quota at all', quota && typeof quota.remaining === 'number');
ok('a read that found nothing cost no credit', quota.remaining === quota.limit);

ok('no case was created from a form with no checklist', (await page.$$('.case')).length === 0);

/* ================= 2. the same form, read badly ================= */
upstream.length = 0;
answer = HELPFUL_HALLUCINATION;
page = await freshPage();
await scan(page);

const body2 = await page.textContent('#aiBody');
ok('the two invented document keys are dropped',
  !body2.includes('אישור משטרה') && !body2.includes('תעודה רפואית'));
ok('the extra with no quote behind it is dropped', !body2.includes('חוות דעת רפואית'));
ok('the one real catalogue key survives — the check drops, it does not refuse',
  body2.includes('תעודת זהות'));
ok('only one item is offered, not four', (await page.$$('#aiBody [data-pick]')).length === 1);
ok('the prose deadline never becomes a date', !body2.includes('תוך שנתיים'));

await page.click('#aiActions button:nth-child(1)');   // add
await page.waitForTimeout(400);
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('klaser.v1') || '{}').cases || []);
ok('a case was created for the one surviving document', stored.length === 1);
ok('it carries exactly one document', stored[0].docs.length === 1);
ok('the case has no deadline invented from prose', !stored[0].deadline);
ok('the form to fill is remembered', stored[0].form && stored[0].form.where === 'self');
const quota2 = await page.evaluate(() => AI.quota);
ok('a read that did find something is charged, so the fix is not "never charge"',
  quota2.remaining === quota2.limit - 1);

/* ================= 3. an agency the catalogue does not have ================= */
upstream.length = 0;
answer = { ...BLANK_FORM, required_docs: [{ key: 'teudat_zehut', evidence: 'צילום ת"ז', confidence: 0.9 }] };
page = await freshPage();
await scan(page);
await page.click('#aiActions button:nth-child(1)');
await page.waitForTimeout(400);
const c3 = (await page.evaluate(() => JSON.parse(localStorage.getItem('klaser.v1') || '{}').cases || []))[0];
ok('קרנית is not silently filed under a neighbouring agency',
  c3.agency !== 'btl' && c3.agency !== 'kupa' && c3.agency !== 'iriya');
ok('it lands in "other", which is honest rather than wrong', c3.agency === 'other');

console.log(errors.length ? '\nERRORS: ' + errors.join(' | ') : '\nNo console or page errors.');
console.log(`\n${pass} passed, ${fail + (errors.length ? 1 : 0)} failed`);
await browser.close();
srv.close();
process.exit(fail || errors.length ? 1 : 0);
