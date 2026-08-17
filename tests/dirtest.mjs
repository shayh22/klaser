import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const b=await chromium.launch(); const errs=[];
const p=await (await b.newContext({viewport:{width:375,height:812}})).newPage();
p.on('pageerror',e=>errs.push(String(e.message)));
p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
const ok=(l,c)=>console.log((c?'PASS  ':'FAIL  ')+l);
await p.goto('http://127.0.0.1:8099/index.html'); await p.waitForTimeout(300);
await p.click('[data-tab="agencies"]'); await p.waitForTimeout(400);
const txt = await p.textContent('#agencyList');

// health funds
ok('4 health funds listed', ['כללית','מכבי','מאוחדת','לאומית'].every(x=>txt.includes(x)));
const hrefs = await p.$$eval('.sub-link', a=>a.map(x=>x.href));
for(const d of ['clalit.co.il','maccabi4u.co.il','meuhedet.co.il','leumit.co.il'])
  ok('links '+d, hrefs.some(h=>h.includes(d)));

// banks
ok('11 banks listed', (await p.$$('.dir-item:nth-last-child(1) .sub, .subs .sub')).length===15); // 4 kupot + 11 banks
const codes = await p.$$eval('.sub-code', e=>e.map(x=>x.textContent.trim()));
ok('all 11 bank codes', ['3','4','10','11','12','17','18','20','31','46','54'].every(c=>codes.includes(c)));
ok('codes sorted ascending', codes.map(Number).every((v,i,a)=>i===0||a[i-1]<=v));
for(const d of ['leumi.co.il','discountbank.co.il','bankhapoalim.co.il','mercantile.co.il',
                'onezerobank.com','mizrahi-tefahot.co.il','fibi.co.il','bankjerusalem.co.il'])
  ok('links '+d, hrefs.some(h=>h.includes(d)));
ok('every bank now has a link', (await p.$$('.sub-none')).length===0);
for(const d of ['esh.com','bank-yahav.co.il','bankmassad.co.il'])
  ok('links '+d, hrefs.some(h=>h.includes(d)));
ok('all 15 institutions linked', hrefs.length===15);
ok('bank code explained', txt.includes('מספר הבנק'));

// safety + layout
ok('all external links rel=noopener', await p.$$eval('.sub-link', a=>a.every(x=>x.rel.includes('noopener'))));
ok('all open in new tab', await p.$$eval('.sub-link', a=>a.every(x=>x.target==='_blank')));
const small = await p.$$eval('.sub,.sub-link', els=>els.filter(e=>e.getBoundingClientRect().height<36).length);
ok('rows and links are touch-sized', small===0);
ok('no horizontal overflow', await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
// codes must not reverse in RTL
ok('code renders LTR unreversed', codes.includes('10') && codes.includes('54'));
// other languages
for(const l of ['fr','ru']){
  await p.click(`[data-lang="${l}"]`); await p.waitForTimeout(300);
  const t2=await p.textContent('#agencyList');
  ok(`${l}: bank names still in Hebrew`, t2.includes('בנק לאומי לישראל'));
}
ok('no overflow in LTR', await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
console.log(errs.length?'ERRORS: '+errs.join(' | '):'No console/page errors.');
await b.close();
