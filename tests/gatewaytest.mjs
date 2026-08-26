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
    { key: 'teudat_zehut', he: 'תעודת זהות', evidence: 'צילום תעודת זהות של שני ההורים', confidence: 0.96 },
    { key: 'bank_confirm', he: 'אישור ניהול חשבון', evidence: 'אישור ניהול חשבון בנק על שם התובע', confidence: 0.95 },
    /* a key the catalogue has never heard of: the document survives, under its name */
    { key: 'shovar_arnona_2049', he: 'שובר ארנונה', evidence: 'נדרש שובר ארנונה', confidence: 0.99 },
    { key: null, he: 'תעודת לידה מתורגמת', evidence: 'עבור ילד שנולד מחוץ לישראל', confidence: 0.72 },
    /* no quote behind it — this is the one that must not survive */
    { key: null, he: 'אישור שאיננו כתוב באף מקום', evidence: '', confidence: 0.99 }
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
ok('a document with no catalogue key is offered by its hebrew name',
  body.includes('תעודת לידה מתורגמת'));
ok('the reference number is shown character for character', body.includes('304-882-1177'));

/* An unlisted key is no longer a reason to discard the document — the catalogue
   translates, it does not permit. What still holds is the quote. */
ok('a document with an unlisted key survives, under its own name', body.includes('שובר ארנונה'));
ok('a document with nothing quoted behind it does not', !body.includes('אישור שאיננו כתוב'));
ok('the prose deadline is not shown as a deadline', !body.includes('תוך 30 יום'));
ok('four items offered, not five', (await page.$$('#aiBody [data-pick]')).length === 4);

/* ---- tick them into a case ---- */
await page.click('#aiActions button:nth-child(1)');          // add
await page.waitForTimeout(400);
ok('a case was created', (await page.$$('.case')).length === 1);
const card = await page.textContent('.case');
ok('the case is filed under the right agency', card.includes('ביטוח לאומי'));
ok('the checklist landed in the case', card.includes('תעודת זהות') && card.includes('תעודת לידה מתורגמת'));
ok('so did the one the shared list had never heard of', card.includes('שובר ארנונה'));
/* Read through the key the app actually writes — 'klaser.v1', holding {lang, cases}.
   An earlier version of this line read a key that has never existed, so it asserted
   nothing about an undefined case and passed on every run. */
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('klaser.v1') || '{}').cases || []);
ok('exactly one case was stored', saved.length === 1);
ok('the case carries no invented deadline', !saved[0].deadline);
ok('all four surviving documents were written to it', saved[0].docs.length === 4);
/* the two with no catalogue key became this user's own vocabulary, so the next
   letter naming them is recognised rather than re-read as a stranger */
const mine = await page.evaluate(() => JSON.parse(localStorage.getItem('klaser.v1') || '{}').mine || {});
ok('the unlisted documents were saved as the user\'s own',
  Object.values(mine.docs || {}).some(d => d.he === 'שובר ארנונה'));

/* ---- one tap undoes it ---- */
ok('undo is offered', (await page.textContent('#aiActions')).length > 0);
await page.click('#aiActions button:nth-child(1)');          // undo (danger, first)
await page.waitForTimeout(300);
ok('undo removes the case entirely', (await page.$$('.case')).length === 0);
/* Undo reaches the vocabulary too. One tap of "undo that" must not leave behind a
   landlord the user never agreed to save — and must not keep sending it. */
const afterUndo = await page.evaluate(() => JSON.parse(localStorage.getItem('klaser.v1') || '{}').mine || {});
ok('undo also unlearns what the add taught',
  !Object.values(afterUndo.docs || {}).some(d => d.he === 'שובר ארנונה'));

/* ---- the point of saving them: the next scan carries them ----
   A name the user kept has to become a key the model may answer with, or "adding
   your own" is a local relabelling the reader never learns. Undo just unlearned
   everything, so this re-adds first — which is also the proof that re-learning
   works after an undo. */
await page.setInputFiles('#letterInput', HERE + 'doc1.jpg');
await page.waitForTimeout(300);
await page.waitForFunction(() =>
  document.querySelector('#aiBody')?.textContent.includes('בדקו לפני'), null, { timeout: 8000 });
await page.click('#aiActions button:nth-child(1)');          // add again
await page.waitForTimeout(400);
const relearned = await page.evaluate(() => JSON.parse(localStorage.getItem('klaser.v1') || '{}').mine || {});
ok('a name can be learned again after an undo',
  Object.values(relearned.docs || {}).some(d => d.he === 'שובר ארנונה'));

upstream.length = 0;
await page.setInputFiles('#letterInput', HERE + 'doc1.jpg');
await page.waitForTimeout(300);
await page.waitForFunction(() =>
  document.querySelector('#aiBody')?.textContent.includes('בדקו לפני'), null, { timeout: 8000 });

const second = upstream[1];
const vocabText = second.messages[1].content.map(c => c.text || '').join('\n');
ok('the next scan carries the names the user kept', vocabText.includes('שובר ארנונה'));
ok('they become keys the model may answer with',
  second.response_format.json_schema.schema.properties.required_docs.items.properties.key.enum
    .some(k => typeof k === 'string' && k.startsWith('own_')));
/* The shared block must stay byte-identical, or every user loses the prompt cache
   the moment they save their first name. */
ok('the shared catalogue block is untouched',
  second.messages[0].content[1].text === upstream[0].messages[0].content[1].text);
ok('the user vocabulary rides with the instruction, not the cached block',
  !second.messages[0].content[1].text.includes('שובר ארנונה'));

/* ---- the failure the deployment actually hit ----
   A gateway that rejects the request gives the browser a Hebrew sentence and nothing
   else, on purpose. That is right for someone filing a claim and useless for whoever
   deployed it, so the sheet also carries our own error code and offers to run the
   five checks against the service. */
let gatewayDown = true;
const savedFetch = gateway;
const rejectAll = async (u, o) => gatewayDown
  ? ({ ok: false, status: 404,
       text: async () => 'No endpoints available matching your guardrail restrictions and data policy' })
  : savedFetch(u, o);
const failing = createApp({
  catalogue,
  adapter: createOpenRouterAdapter({ apiKey: 'sk-or-test', fetchImpl: rejectAll }),
  /* the preflight route talks to the gateway itself, so it needs the stub too */
  fetchImpl: rejectAll,
  env: { FREE_CREDITS: '10', OPENROUTER_API_KEY: 'sk-or-test' }
});
const failPort = 8796;
const failSrv = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const request = new Request('http://127.0.0.1:' + failPort + req.url, {
    method: req.method, headers: req.headers,
    body: (req.method === 'GET' || req.method === 'HEAD') ? undefined : Buffer.concat(chunks)
  });
  const out = await failing(request);
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(Buffer.from(await out.arrayBuffer()));
});
await new Promise(r => failSrv.listen(failPort, '127.0.0.1', r));

const fctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const fp = await fctx.newPage();
await fp.addInitScript(e => { window.KLASER_AI_ENDPOINT = e; }, 'http://127.0.0.1:' + failPort);
await fp.goto(APP, { waitUntil: 'load' });
await fp.waitForTimeout(250);
await fp.setInputFiles('#letterInput', HERE + 'doc1.jpg');
await fp.waitForTimeout(300);
await fp.click('#aiActions button:nth-child(1)');            // consent
await fp.waitForFunction(() => {
  const b = document.querySelector('#aiBody');
  return b && !b.textContent.includes('קורא');
}, null, { timeout: 12000 });

const errText = await fp.textContent('#aiBody');
ok('the browser is told in Hebrew that analysis is unavailable', /לא זמין/.test(errText));
ok('the upstream words never reach the browser', !/guardrail|endpoints|404/.test(errText));
ok('but our own error code does', /upstream_error/.test(errText));
const errButtons = await fp.$$eval('#aiActions button', bs => bs.map(b => b.textContent));
ok('and the sheet offers to find out why', errButtons.some(t => /בדיקת חיבור/.test(t)));

/* running it names the routing filter, which is the actual cause */
await fp.click('#aiActions button:nth-child(1)');
await fp.waitForFunction(() => {
  const b = document.querySelector('#aiBody');
  return b && !b.textContent.includes('בודק');
}, null, { timeout: 20000 });
const checkText = await fp.textContent('#aiBody');
ok('the check names the privacy routing, not a missing model',
  /privacy routing/.test(checkText));
ok('and names the variables that would relax it', /OPENROUTER_ZDR=0/.test(checkText));
ok('no key material appears in the result', !/sk-or/.test(checkText));
await fctx.close();
failSrv.close();

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
