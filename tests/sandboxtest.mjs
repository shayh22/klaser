/* The artifact viewer runs the page inside a sandboxed cross-origin iframe where a
   phone camera is unreachable. This drives the demo the way a person on a phone
   does — a real tap, no programmatic file input — so a dead-end button fails here
   instead of in someone's hand. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { execFileSync } from 'node:child_process';
const ROOT = new URL('..', import.meta.url).pathname;
execFileSync('node', [ROOT + 'tools/build-demo.mjs', ROOT + 'demo-preview.html']);

let pass = 0, fail = 0;
const ok = (m, c) => { c ? (pass++, console.log('PASS  ' + m)) : (fail++, console.log('FAIL  ' + m)); };

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errs = [], pickers = [];
page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
page.on('filechooser', fc => { pickers.push(1); fc.setFiles([]).catch(() => {}); });

await page.setContent(`<!doctype html><meta charset=utf-8>
  <iframe sandbox="allow-scripts allow-same-origin" src="http://127.0.0.1:8099/demo-preview.html"
          style="width:390px;height:800px;border:0"></iframe>`, { waitUntil: 'load' });
await page.waitForTimeout(1200);
const fr = page.frames().find(f => f.url().includes('demo-preview'));
ok('page loads inside a sandboxed iframe', !!fr);

await fr.click('#emptyScan');
await page.waitForTimeout(600);
ok('a tap alone opens consent — no photo required',
  await fr.evaluate(() => document.querySelector('#aiModal')?.dataset.open === '1'));
ok('the demo never opens a file picker', pickers.length === 0);
ok('consent says no photo is needed', (await fr.textContent('#aiBody')).includes('אין צורך לצלם'));

await fr.click('#aiActions button:nth-child(1)');
await fr.waitForFunction(() =>
  document.querySelector('#aiBody')?.textContent.includes('בדקו לפני'), null, { timeout: 8000 });
ok('the analysis completes from a tap', (await fr.$$('#aiBody [data-pick]')).length === 5);

await fr.click('#aiActions button:nth-child(1)');
await page.waitForTimeout(500);
ok('case created', (await fr.$$('.case')).length === 1);

/* the real app must still let people pick an already-taken photo */
const attr = await fr.evaluate(() => document.querySelector('#letterInput').getAttribute('capture'));
ok('letter input does not force the camera', attr === null);

errs.forEach(e => console.log('    ' + e));
ok('no console or page errors', errs.length === 0);
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
execFileSync('rm', ['-f', ROOT + 'demo-preview.html']);
process.exit(fail ? 1 : 0);
