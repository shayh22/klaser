import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const b=await chromium.launch(); const errs=[];
const p=await (await b.newContext({viewport:{width:375,height:812}})).newPage();
p.on('pageerror',e=>errs.push(String(e.message)));
p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
const ok=(l,c)=>console.log((c?'PASS  ':'FAIL  ')+l);
await p.goto('http://127.0.0.1:8099/index.html'); await p.waitForTimeout(400);

ok('quick-start shown on empty', await p.isVisible('.quick-grid'));
ok('six starter options', (await p.$$('.qbtn')).length===6);
const bb = await (await p.$('.qbtn')).boundingBox();
ok('starter buttons >=44px tall', bb.height>=44);
ok('"something else" escape hatch present', await p.isVisible('#emptyNew'));

// THE measurement: interactions from cold start to a usable case
let taps=0;
await p.click('.qbtn'); taps++;
await p.waitForTimeout(400);
ok('one tap creates a case', (await p.$$('.case')).length===1);
console.log(`      >> interactions to first usable case: ${taps}`);
ok('case arrives with its document list', (await p.$$('.doc')).length>=3);
ok('case opens expanded', await p.isVisible('.case-body'));
ok('quick-start disappears once used', !(await p.isVisible('.quick-grid')));
ok('toolbar CTA returns', await p.isVisible('#newCase'));

// persists
await p.reload(); await p.waitForTimeout(400);
ok('survives reload', (await p.$$('.case')).length===1);

// escape hatch still opens the full editor
await p.evaluate(()=>{cases=[];save();render();}); await p.waitForTimeout(300);
await p.click('#emptyNew'); await p.waitForTimeout(300);
ok('"something else" opens the editor', await p.getAttribute('#modal','data-open')==='1');
await p.click('#cancelCase');

// all four languages render the grid
for(const l of ['fr','en','ru']){
  await p.click(`[data-lang="${l}"]`); await p.waitForTimeout(300);
  const n=(await p.$$('.qbtn')).length;
  const heShown = (await p.textContent('.quick-grid')).match(/[֐-׿]/);
  ok(`${l}: grid renders with Hebrew agency name`, n===6 && !!heShown);
}
ok('no overflow with grid', await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
console.log(errs.length?'ERRORS: '+errs.join(' | '):'No console/page errors.');
await b.close();
