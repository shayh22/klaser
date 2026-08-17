/* The Artifact/standalone package built by tools/build-demo.mjs. Builds it fresh,
   serves it, and drives the same flow — so a packaging mistake (a stripped charset,
   a dangling video reference) fails here rather than on someone's phone. */
import { execFileSync } from 'node:child_process';
const HERE = new URL('.', import.meta.url).pathname;
const ROOT = new URL('..', import.meta.url).pathname;
execFileSync('node', [ROOT + 'tools/build-demo.mjs', ROOT + 'demo-preview.html']);
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true });
const page = await ctx.newPage();
const errs=[], reqs=[];
page.on('pageerror', e=>errs.push('PAGEERROR '+e.message));
page.on('console', m=>{ if(m.type()==='error') errs.push('CONSOLE '+m.text()); });
page.on('request', r=>reqs.push(r.url()));
let p=0,f=0; const ok=(m,c)=>{c?(p++,console.log('PASS  '+m)):(f++,console.log('FAIL  '+m));};

await page.goto('http://127.0.0.1:8099/demo-preview.html',{waitUntil:'load'});
await page.waitForTimeout(500);
ok('page renders', (await page.textContent('h1')).includes('קלסר'));
ok('demo mode is on without a query string', !!(await page.$('#emptyScan')));
ok('no hero video in the package', (await page.$$('video')).length === 0);
await page.setInputFiles('#letterInput', HERE + 'doc1.jpg');
await page.waitForTimeout(300);
await page.click('#aiActions button:nth-child(1)');
await page.waitForFunction(()=>document.querySelector('#aiBody')?.textContent.includes('בדקו לפני'),null,{timeout:8000});
ok('demo analysis completes', (await page.$$('#aiBody [data-pick]')).length === 5);
ok('labelled as demo', (await page.textContent('#aiBody')).includes('מצב הדגמה'));
await page.click('#aiActions button:nth-child(1)');
await page.waitForTimeout(400);
ok('case created', (await page.$$('.case')).length === 1);
const off=[...new Set(reqs.filter(u=>/^https?:/.test(u)).map(u=>new URL(u).origin))].filter(o=>o!=='http://127.0.0.1:8099');
ok('zero off-origin requests', off.length===0); if(off.length) console.log('   ',off);
errs.forEach(e=>console.log('    '+e));
ok('no console or page errors', errs.length===0);
console.log(`\n${p} passed, ${f} failed`);
await b.close();
execFileSync('rm', ['-f', ROOT + 'demo-preview.html']);
process.exit(f?1:0);
