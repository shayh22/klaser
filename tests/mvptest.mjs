/* End-to-end MVP: scan a letter -> checklist -> collect -> fill the form.
   Runs the real Worker handler and the real page. Nothing is stubbed inside the
   app; only the model provider is the mock adapter. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const APP = 'http://127.0.0.1:8099/index.html';
const API = 'http://127.0.0.1:8788';
const HERE = new URL('.', import.meta.url).pathname;

let pass = 0, fail = 0;
const ok = (m, c) => { c ? (pass++, console.log('PASS  ' + m)) : (fail++, console.log('FAIL  ' + m)); };

/* a non-image file passes through compress() untouched, which is how the mock
   directive survives the client's re-encode */
const directive = o => {
  const f = HERE + 'mock-' + Math.random().toString(36).slice(2, 8) + '.pdf';
  writeFileSync(f, 'KLASER-MOCK:' + JSON.stringify(o));
  return f;
};

const srv = spawn('node', [new URL('../server/dev.js', import.meta.url).pathname], {
  env: { ...process.env, PORT: '8788', FREE_CREDITS: '10' }, stdio: 'ignore'
});
await new Promise(r => setTimeout(r, 700));

const browser = await chromium.launch();
const errors = [];
const requests = [];

async function newPage({ endpoint = API } = {}) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });
  page.on('request', r => requests.push({ url: r.url(), body: r.postData() || '' }));
  if (endpoint) await page.addInitScript(e => { window.KLASER_AI_ENDPOINT = e; }, endpoint);
  await page.goto(APP, { waitUntil: 'load' });
  await page.waitForTimeout(250);
  return { ctx, page };
}

/* ---------- 1. the feature is invisible until an endpoint is configured ---- */
{
  const { ctx, page } = await newPage({ endpoint: null });
  ok('AI off: no scan-letter button', await page.isHidden('#scanLetter'));
  ok('AI off: empty state offers no scan', !(await page.$('#emptyScan')));
  const thirdParty = requests.filter(r => !r.url.startsWith('http://127.0.0.1:8099'));
  ok('AI off: zero requests off-origin', thirdParty.length === 0);
  await ctx.close();
}

requests.length = 0;

/* ---------- 2. consent gate ------------------------------------------------ */
const { ctx, page } = await newPage();
/* the toolbar is deliberately hidden while the list is empty — the empty card
   owns the action there — so the scan entry point is the empty-state button */
ok('AI on: scan-letter button exists', !!(await page.$('#scanLetter')));
ok('AI on: empty state offers scan', !!(await page.$('#emptyScan')));

await page.setInputFiles('#letterInput', HERE + 'doc1.jpg');
await page.waitForTimeout(300);
ok('consent asked before anything is sent', await page.isVisible('#aiModal .sheet'));
ok('consent explains the fallback',
  (await page.textContent('#aiBody')).includes('ממשיך לעבוד'));
ok('nothing sent while consent is pending',
  requests.filter(r => r.url.startsWith(API + '/v1/analyze')).length === 0);

/* decline: nothing happens, no case, no request */
await page.click('#aiActions button:nth-child(2)');
await page.waitForTimeout(200);
ok('declining sends nothing', requests.filter(r => r.url.includes('/v1/analyze')).length === 0);
ok('declining creates no case', (await page.$$('.case')).length === 0);

/* ---------- 3. accept -> analyse -> review --------------------------------- */
await page.setInputFiles('#letterInput', HERE + 'doc1.jpg');
await page.waitForTimeout(200);
await page.click('#aiActions button:nth-child(1)');       // accept
await page.waitForFunction(() =>
  document.querySelector('#aiBody')?.textContent.includes('בדקו לפני'), null, { timeout: 8000 });

const body = await page.textContent('#aiBody');
ok('review lists the required documents', body.includes('תעודת זהות') && body.includes('אישור ניהול חשבון'));
ok('review quotes the evidence from the letter', body.includes('צילום תעודת זהות של שני ההורים'));
ok('review flags the unrecognised document', body.includes('לא מזוהה'));
ok('review shows the reference number', body.includes('304-882-1177'));
ok('review shows remaining credits', /9/.test(body));
ok('5 items offered', (await page.$$('#aiBody [data-pick]')).length === 5);
ok('nothing written to a case yet', (await page.$$('.case')).length === 0);

/* untick the unverified extra document */
await page.uncheck('#aiBody [data-pick="x0"]');
await page.click('#aiActions button:nth-child(1)');       // add to case
await page.waitForTimeout(400);

ok('case created', (await page.$$('.case')).length === 1);
ok('only the ticked items were added', (await page.$$('.doc')).length === 4);
const cardText = await page.textContent('#caseList');
ok('unticked item was not added', !cardText.includes('שנולד בחו'));
ok('agency came from the letter', cardText.includes('ביטוח לאומי'));

/* ---------- 4. undo -------------------------------------------------------- */
ok('undo offered after adding', (await page.textContent('#aiBody')).includes('נוסף לתיק'));
await page.click('#aiActions button:nth-child(1)');       // undo
await page.waitForTimeout(300);
ok('undo removes the case', (await page.$$('.case')).length === 0);

/* ---------- 5. redo, collect everything, fill the form --------------------- */
await page.setInputFiles('#letterInput', HERE + 'doc1.jpg');
await page.waitForTimeout(200);
await page.waitForFunction(() =>
  document.querySelector('#aiBody')?.textContent.includes('בדקו לפני'), null, { timeout: 8000 });
await page.click('#aiActions button:nth-child(1)');
await page.waitForTimeout(300);
await page.click('#aiActions button:nth-child(2)');       // close
await page.waitForTimeout(200);

ok('fill button hidden while documents are missing', !(await page.$('[data-act="fill"]')));

/* Each tick re-renders the card, so a Playwright handle detaches mid-action.
   Drive the change event directly and let the app re-render between ticks. */
const total = (await page.$$('.doc input[type=checkbox]')).length;
for (let i = 0; i < total; i++) {
  await page.evaluate(() => {
    const b = document.querySelector('.doc input[type=checkbox]:not(:checked)');
    if (b) { b.checked = true; b.dispatchEvent(new Event('change', {bubbles:true})); }
  });
  await page.waitForTimeout(90);
}
await page.waitForTimeout(250);
ok('every document is now ticked',
  (await page.$$('.doc input[type=checkbox]:not(:checked)')).length === 0);
ok('scan-letter button shows once a case exists', await page.isVisible('#scanLetter'));
ok('fill offered once everything is collected', !!(await page.$('[data-act="fill"]')));
ok('the letter told us there is a form in it',
  (await page.textContent('#caseList')).includes('אפשר למלא'));

await page.click('[data-act="fill"]');
await page.waitForTimeout(250);
const fillBody = await page.textContent('#fillBody');
ok('fill sheet opens', await page.isVisible('#fillModal .sheet'));
ok('fill sheet names the form', fillBody.includes('בקשה לקצבת ילדים'));
ok('fill sheet says it is on-device only', fillBody.includes('לא נשלחים'));
ok('field map produced its fields', (await page.$$('#fillBody [data-fill]')).length === 12);
ok('empty required fields are counted', fillBody.includes('שדות חסרים'));

/* ---------- 6. the profile never leaves the device ------------------------- */
const SECRET_ID = '039335393';       // valid check digit (verified)
const SECRET_NAME = 'שיין־בדיקה פרטי';
await page.fill('[data-fill="full_name"]', SECRET_NAME);
await page.fill('[data-fill="id_number"]', SECRET_ID);
await page.fill('[data-fill="bank_account"]', '11223344');
await page.click('#fillSaveBtn');
await page.waitForTimeout(300);

ok('profile persists after save', (await page.inputValue('[data-fill="full_name"]')) === SECRET_NAME);
ok('valid ID passes the check digit', !(await page.textContent('#fillBody')).includes('✗'));

await page.fill('[data-fill="id_number"]', '123456789');   // bad check digit
await page.click('#fillSaveBtn');
await page.waitForTimeout(300);
ok('invalid ID is flagged', (await page.textContent('#fillBody')).includes('✗'));

await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(300);
/* the card remembers whether it was open — only toggle when it is closed */
if (await page.getAttribute('.case', 'open-state') !== '1') {
  await page.click('.case-head');
  await page.waitForTimeout(200);
}
await page.click('[data-act="fill"]');
await page.waitForTimeout(250);
ok('profile survives a reload', (await page.inputValue('[data-fill="full_name"]')) === SECRET_NAME);

/* the network-level version of the promise */
const leaked = requests.filter(r =>
  r.body && (r.body.includes(SECRET_ID) || r.body.includes(SECRET_NAME) || r.body.includes('11223344')));
ok('no request anywhere carried a profile value', leaked.length === 0);

/* blob: and data: are in-document object URLs, not network egress */
const offOrigin = [...new Set(requests
  .filter(r => /^https?:/.test(r.url))
  .map(r => new URL(r.url).origin)
  .filter(o => o !== 'http://127.0.0.1:8099'))];
ok('the only off-origin host is our own API', offOrigin.every(o => o === API));
if (!offOrigin.every(o => o === API)) console.log('    off-origin:', offOrigin);

/* ---------- 7. service down -> the app carries on -------------------------- */
/* Everything up to here must be completely clean. The outage below deliberately
   provokes a failed request, which the browser logs — so the strict assertion
   belongs before it, not after. */
ok('no console or page errors during the whole normal flow', errors.length === 0);
errors.forEach(e => console.log('    ' + e));
const errsBeforeOutage = errors.length;

await page.click('#fillCloseBtn');          // the fill sheet is still open
await page.waitForTimeout(200);
/* Racing a process kill is flaky; pointing the client at a closed port tests the
   same failure path deterministically. */
await page.evaluate(() => { AI.cfg.endpoint = 'http://127.0.0.1:8799'; AI.token = null; });
await page.setInputFiles('#letterInput', HERE + 'doc1.jpg');
await page.waitForFunction(() => {
  const b = document.querySelector('#aiBody');
  return b && !b.textContent.includes('קורא את המכתב');
}, null, { timeout: 15000 });
const downText = await page.textContent('#aiBody');
ok('a dead service explains itself in Hebrew', /לא זמין|השתבש|ממשיך/.test(downText));
await page.click('#aiActions button');
await page.waitForTimeout(200);
ok('the case list is untouched by the failure', (await page.$$('.case')).length === 1);

/* the outage may add resource-load failures and nothing else */
const newErrs = errors.slice(errsBeforeOutage);
ok('the outage produced no script errors, only the failed request',
  newErrs.every(e => /Failed to load resource|ERR_/.test(e)));
newErrs.filter(e => !/Failed to load resource|ERR_/.test(e)).forEach(e => console.log('    ' + e));
console.log(`\n${pass} passed, ${fail} failed`);

await ctx.close();
await browser.close();
try { srv.kill(); } catch {}
process.exit(fail ? 1 : 0);
