/* The deployed shape: app and API from one Worker, one origin.
 *
 * Nothing is configured by hand here — no KLASER_AI_ENDPOINT is injected by the
 * test. If the flow works, it is because the Worker told the page where the API
 * is, which is exactly what happens on Cloudflare.
 */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
const ROOT = new URL('..', import.meta.url).pathname;
const HERE = new URL('.', import.meta.url).pathname;
const BASE = 'http://127.0.0.1:8790';

let pass = 0, fail = 0;
const ok = (m, c) => { c ? (pass++, console.log('PASS  ' + m)) : (fail++, console.log('FAIL  ' + m)); };

/* A server left behind by an earlier run keeps the port and serves stale code,
   which looks exactly like a code failure. Refuse to run rather than lie. */
try {
  await fetch(BASE + '/v1/health', { signal: AbortSignal.timeout(500) });
  console.error(`Something is already listening on ${BASE}. Stop it and re-run:\n  pkill -f server/dev.js`);
  process.exit(2);
} catch { /* nothing there, which is what we want */ }

const srv = spawn('node', [ROOT + 'server/dev.js'], {
  env: { ...process.env, PORT: '8790', FREE_CREDITS: '10' }, stdio: 'ignore'
});
await new Promise(r => setTimeout(r, 900));

/* the API answers on the same host that serves the page */
const health = await (await fetch(BASE + '/v1/health')).json();
ok('health served from the app origin', health.status === 'ok');
ok('mock provider without a key', health.provider === 'mock');

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errs = [], origins = new Set();
page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
page.on('request', r => { if (/^https?:/.test(r.url())) origins.add(new URL(r.url()).origin); });

await page.goto(BASE + '/', { waitUntil: 'load' });
await page.waitForTimeout(500);

ok('the app is served by the Worker', (await page.textContent('h1')).includes('קלסר'));
ok('the page was told where the API is',
  await page.evaluate(() => typeof window.KLASER_AI_ENDPOINT === 'string'));
ok('the endpoint follows the origin it was served from',
  await page.evaluate(() => window.KLASER_AI_ENDPOINT === location.origin));
ok('the feature switched itself on', !!(await page.$('#emptyScan')));

/* full flow, no configuration anywhere */
await page.setInputFiles('#letterInput', HERE + 'doc1.jpg');
await page.waitForTimeout(300);
await page.click('#aiActions button:nth-child(1)');
await page.waitForFunction(() =>
  document.querySelector('#aiBody')?.textContent.includes('בדקו לפני'), null, { timeout: 10000 });
ok('analysis works same-origin', (await page.$$('#aiBody [data-pick]')).length === 5);

await page.click('#aiActions button:nth-child(1)');
await page.waitForTimeout(400);
ok('case created', (await page.$$('.case')).length === 1);

ok('every request stayed on one origin', [...origins].length === 1 && [...origins][0] === BASE);
if ([...origins].length !== 1) console.log('    origins:', [...origins]);

/* static files still serve */
const css = await fetch(BASE + '/contracts/catalogue.json');
ok('static files serve from the Worker', css.status === 200);
const miss = await fetch(BASE + '/nope-does-not-exist');
ok('a genuine miss is still a 404', miss.status === 404);

errs.forEach(e => console.log('    ' + e));
ok('no console or page errors', errs.length === 0);
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
srv.kill();
process.exit(fail ? 1 : 0);
