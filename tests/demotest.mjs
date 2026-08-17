/* Demo mode: the whole flow, on a phone-sized screen, with no server and — the
   part that matters — no network request of any kind. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const HERE = new URL('.', import.meta.url).pathname;
const APP = 'http://127.0.0.1:8099/index.html';

let pass = 0, fail = 0;
const ok = (m, c) => { c ? (pass++, console.log('PASS  ' + m)) : (fail++, console.log('FAIL  ' + m)); };

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [], reqs = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });
page.on('request', r => reqs.push(r.url()));

await page.goto(APP + '?demo=1', { waitUntil: 'load' });
await page.waitForTimeout(400);

ok('demo mode turns the feature on', !!(await page.$('#emptyScan')));

await page.setInputFiles('#letterInput', HERE + 'doc1.jpg');
await page.waitForTimeout(300);
ok('consent still asked in demo mode', await page.isVisible('#aiModal .sheet'));
ok('demo is labelled on the consent sheet', (await page.textContent('#aiBody')).includes('מצב הדגמה'));

await page.click('#aiActions button:nth-child(1)');
await page.waitForFunction(() =>
  document.querySelector('#aiBody')?.textContent.includes('בדקו לפני'), null, { timeout: 8000 });
ok('demo is labelled on the review sheet too', (await page.textContent('#aiBody')).includes('מצב הדגמה'));
ok('review offers the documents', (await page.$$('#aiBody [data-pick]')).length === 5);

await page.click('#aiActions button:nth-child(1)');
await page.waitForTimeout(400);
ok('case created on mobile', (await page.$$('.case')).length === 1);
await page.click('#aiActions button:nth-child(2)');
await page.waitForTimeout(200);

const total = (await page.$$('.doc input[type=checkbox]')).length;
for (let i = 0; i < total; i++) {
  await page.evaluate(() => {
    const x = document.querySelector('.doc input[type=checkbox]:not(:checked)');
    if (x) { x.checked = true; x.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await page.waitForTimeout(80);
}
await page.waitForTimeout(250);
await page.click('[data-act="fill"]');
await page.waitForTimeout(300);
ok('fill sheet reachable on a phone', await page.isVisible('#fillModal .sheet'));

/* tap targets and horizontal overflow, on the narrow viewport */
const small = await page.evaluate(() => [...document.querySelectorAll('#fillBody input, #aiActions button')]
  .filter(e => e.offsetParent !== null && e.getBoundingClientRect().height < 44).length);
ok('every control in the new sheets is at least 44px tall', small === 0);
ok('no horizontal overflow at 390px',
  await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

const off = [...new Set(reqs.filter(u => /^https?:/.test(u)).map(u => new URL(u).origin))]
  .filter(o => o !== 'http://127.0.0.1:8099');
ok('demo mode makes zero off-origin requests', off.length === 0);
if (off.length) console.log('    ', off);

errors.forEach(e => console.log('    ' + e));
ok('no console or page errors', errors.length === 0);
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
