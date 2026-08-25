/* The feature, end to end, over the gateway: photograph a letter, get a checklist
 * into a case.
 *
 * Everything real except the one thing that cannot be: the page, the client, the
 * consent gate, the Worker handler, the OpenRouter adapter and the catalogue check
 * all run as deployed. Only the gateway itself is replaced, by a fetch that answers
 * with the response shape OpenRouter documents.
 *
 * tests/mvptest.mjs already covers this path against the mock adapter. This one
 * exists because the mock never sees a request and so cannot exercise the adapter
 * that will actually be deployed — and because the two things a gateway changes
 * (whether the schema was enforced, and whether the checklist survives it) are only
 * visible from the far end, in the review sheet the user actually ticks.
 */
import { chromium } from './browser.mjs';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createApp } from '../server/index.js';
import { createOpenRouterAdapter } from '../server/adapters/openrouter.js';

const APP = 'http://127.0.0.1:8099/index.html';
const PORT = 8793;
const API = 'http://127.0.0.1:' + PORT;
const HERE = new URL('.', import.meta.url).pathname;
const ROOT = new URL('..', import.meta.url).pathname;
const catalogue = JSON.parse(readFileSync(ROOT + 'contracts/catalogue.json', 'utf8'));

let pass = 0, fail = 0;
const ok = (m, c) => { c ? (pass++, console.log('PASS  ' + m)) : (fail++, console.log('FAIL  ' + m)); };

/* What the gateway sends back. The read deliberately contains one document that is
   not in the catalogue and one deadline that is not a date — the two things a
   provider that shrugged at the schema would produce. Neither may reach the case. */
const IDENT = { is_letter: true, agency: 'btl', form_code: 'בל/5020',
                form_title_he: 'בקשה לקצבת ילדים', personalised: false };
const READ = {
  agency: 'btl', agency_child: null, template: 'child_allowance',
  required_docs: [
    { key: 'teudat_zehut', evidence: 'צילום תעודת זהות של שני ההורים', confidence: 0.96 },
    { key: 'bank_confirm', evidence: 'אישור ניהול חשבון בנק על שם התובע', confidence: 0.95 },
    { key: 'shovar_arnona_2049', evidence: 'נדרש שובר ארנונה', confidence: 0.99 }
  ],
  extra_docs: [
    { he: 'תעודת לידה מתורגמת', evidence: 'עבור ילד שנולד מחוץ לישראל', confidence: 0.72 }
  ],
  deadline: 'תוך 30 יום', letter_date: '2026-08-02', reference: '304-882-1177',
  form_code: 'בל/5020', form_title_he: 'בקשה לקצבת ילדים',
  form_to_fill: { where: 'self', form_code: 'בל/5020', form_title_he: 'בקשה לקצבת ילדים' },
  personalised: false, confidence: 0.91, language: 'he'
};

const upstream = [];
const gateway = async (url, opts) => {
  const body = JSON.parse(opts.body);
  upstream.push(body);
  /* identify is the cheap model; whichever call is not that one is the read */
  const isIdentify = body.model.includes('haiku');
  return {
    ok: true,
    json: async () => ({
      model: body.model,
      choices: [{ message: { content: JSON.stringify(isIdentify ? IDENT : READ) } }],
      usage: { prompt_tokens: 3000, completion_tokens: 400,
               prompt_tokens_details: { cached_tokens: 1500 }, cost: 0.0042 }
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
    method: req.method,
    headers: req.headers,
    body: (req.method === 'GET' || req.method === 'HEAD') ? undefined : Buffer.concat(chunks)
  });
  const out = await app(request);
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(Buffer.from(await out.arrayBuffer()));
});
await new Promise(r => srv.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch();
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });
await page.addInitScript(e => { window.KLASER_AI_ENDPOINT = e; }, API);
await page.goto(APP, { waitUntil: 'load' });
await page.waitForTimeout(250);

/* ---- health says which provider is answering ---- */
const health = await (await fetch(API + '/v1/health')).json();
ok('health names the gateway as the provider', health.provider === 'openrouter');

/* ---- scan a letter ---- */
ok('the scan entry point is offered', !!(await page.$('#emptyScan')));
await page.setInputFiles('#letterInput', HERE + 'doc1.jpg');
await page.waitForTimeout(300);
ok('consent is asked before anything is sent', await page.isVisible('#aiModal .sheet'));
ok('nothing reached the gateway while consent was pending', upstream.length === 0);

await page.click('#aiActions button:nth-child(1)');          // accept
await page.waitForFunction(() =>
  document.querySelector('#aiBody')?.textContent.includes('בדקו לפני'), null, { timeout: 8000 });

/* ---- what actually went to the gateway ---- */
ok('two calls: identify then read', upstream.length === 2);
ok('the letter travelled as a data URL',
  upstream[1].messages[1].content[0].image_url.url.startsWith('data:image/jpeg;base64,'));
ok('the catalogue was sent, and cached', !!upstream[1].messages[0].content[1].cache_control);
ok('the schema was demanded', upstream[1].response_format.json_schema.strict === true);
ok('no provider that retains the letter', upstream[1].provider.zdr === true);

/* ---- and what came back, after the catalogue check ---- */
const body = await page.textContent('#aiBody');
ok('the review lists the documents the letter asked for',
  body.includes('תעודת זהות') && body.includes('אישור ניהול חשבון'));
ok('the review quotes the letter for each one',
  body.includes('צילום תעודת זהות של שני ההורים'));
ok('the unrecognised document is offered, and flagged as such',
  body.includes('תעודת לידה מתורגמת') && body.includes('לא מזוהה'));
ok('the reference number is shown character for character', body.includes('304-882-1177'));

/* the two the gateway got wrong */
ok('the invented document never reaches the user', !body.includes('שובר ארנונה'));
ok('the prose deadline is not shown as a deadline', !body.includes('תוך 30 יום'));
ok('three items offered, not four', (await page.$$('#aiBody [data-pick]')).length === 3);

/* ---- tick them into a case ---- */
await page.click('#aiActions button:nth-child(1)');          // add
await page.waitForTimeout(400);
ok('a case was created', (await page.$$('.case')).length === 1);
const card = await page.textContent('.case');
ok('the case is filed under the right agency', card.includes('ביטוח לאומי'));
ok('the checklist landed in the case', card.includes('תעודת זהות') && card.includes('תעודת לידה מתורגמת'));
ok('the invented document did not land either', !card.includes('שובר ארנונה'));
/* Read through the key the app actually writes — 'klaser.v1', holding {lang, cases}.
   An earlier version of this line read a key that has never existed, so it asserted
   nothing about an undefined case and passed on every run. */
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('klaser.v1') || '{}').cases || []);
ok('exactly one case was stored', saved.length === 1);
ok('the case carries no invented deadline', !saved[0].deadline);
ok('the two surviving documents were written to it', saved[0].docs.length === 3);

/* ---- one tap undoes it ---- */
ok('undo is offered', (await page.textContent('#aiActions')).length > 0);
await page.click('#aiActions button:nth-child(1)');          // undo (danger, first)
await page.waitForTimeout(300);
ok('undo removes the case entirely', (await page.$$('.case')).length === 0);

/* ---- with the endpoint gone, the app is the app it was before ---- */
const plain = await browser.newContext();
const p2 = await plain.newPage();
await p2.goto(APP, { waitUntil: 'load' });
await p2.waitForTimeout(200);
ok('no endpoint, no scan button', !(await p2.$('#emptyScan')));

console.log(errors.length ? '\nERRORS: ' + errors.join(' | ') : '\nNo console or page errors.');
console.log(`\n${pass} passed, ${fail + (errors.length ? 1 : 0)} failed`);
await browser.close();
srv.close();
process.exit(fail || errors.length ? 1 : 0);
