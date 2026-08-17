import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const b=await chromium.launch(); const errs=[];
const p=await (await b.newContext({viewport:{width:375,height:812}})).newPage();
p.on('pageerror',e=>errs.push(String(e.message)));
p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
const ok=(l,c)=>console.log((c?'PASS  ':'FAIL  ')+l);
await p.goto('http://127.0.0.1:8099/index.html');
await p.evaluate(()=>localStorage.setItem('klaser.v1',JSON.stringify({lang:'he',cases:[
 {id:'a',title:'תיק בודד',agency:'btl',status:'waiting',ref:'',opened:'2026-08-01',deadline:'',open:false,
  docs:[{id:'1',key:'teudat_zehut',done:false}],notes:[]}]})));
await p.reload(); await p.waitForTimeout(400);
ok('toolbar CTA visible when cases exist', await p.isVisible('#newCase'));
ok('stats visible when cases exist', await p.isVisible('#stats'));
// there is exactly one status filter with matches; pick a different one via the data
await p.evaluate(()=>{ filter='problem'; render(); });
await p.waitForTimeout(300);
ok('filtered-empty shows a message', (await p.textContent('#caseList')).includes('אין תיקים בשלב הזה'));
ok('filtered-empty offers a way back', await p.isVisible('#clearFilter'));
await p.click('#clearFilter'); await p.waitForTimeout(300);
ok('reset restores the list', (await p.$$('.case')).length===1);
// empty-list chrome hidden
await p.evaluate(()=>{ cases=[]; save(); render(); });
await p.waitForTimeout(300);
ok('toolbar hidden when empty', !(await p.isVisible('#newCase')));
ok('stats hidden when empty', !(await p.isVisible('#stats')));
ok('filters hidden when empty', !(await p.isVisible('#filters')));
ok('empty card CTA present', await p.isVisible('#emptyNew'));
console.log(errs.length?'ERRORS: '+errs.join(' | '):'No console/page errors.');
await b.close();
