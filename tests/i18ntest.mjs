import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const b=await chromium.launch(); const errs=[];
const p=await (await b.newContext({viewport:{width:375,height:812}})).newPage();
p.on('pageerror',e=>errs.push(String(e.message)));
p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
const ok=(l,c)=>console.log((c?'PASS  ':'FAIL  ')+l);
const T=async()=>(await p.textContent('.case-title')).trim();
await p.goto('http://127.0.0.1:8099/index.html'); await p.waitForTimeout(400);

// --- the reported bug: create in Hebrew, read in French ---
await p.click('.qbtn'); await p.waitForTimeout(400);
const he = await T();
ok('created in Hebrew', he==='הנפקת תעודת זהות');
await p.click('[data-lang="fr"]'); await p.waitForTimeout(400);
ok('title follows to French', (await T())==="Obtenir la carte d'identité");
await p.click('[data-lang="ru"]'); await p.waitForTimeout(400);
ok('title follows to Russian', (await T())==='Получить удостоверение личности');
await p.click('[data-lang="en"]'); await p.waitForTimeout(400);
ok('title follows to English', (await T())==='Get an Israeli ID card');
await p.click('[data-lang="he"]'); await p.waitForTimeout(400);
ok('and back to Hebrew', (await T())===he);
ok('documents translate too', (await p.textContent('.doc')).includes('דרכון'));

// --- a title the user typed must NOT be rewritten ---
await p.click('[data-act="edit"]'); await p.waitForTimeout(300);
ok('editor prefills the derived title', (await p.inputValue('#fTitle'))===he);
await p.fill('#fTitle','התיק של אמא');
await p.click('#saveCase'); await p.waitForTimeout(400);
ok('custom title saved', (await T())==='התיק של אמא');
await p.click('[data-lang="fr"]'); await p.waitForTimeout(400);
ok('custom title survives language switch', (await T())==='התיק של אמא');
await p.reload(); await p.waitForTimeout(400);
ok('custom title survives reload', (await T())==='התיק של אמא');

// --- clearing back to the template name returns it to automatic ---
await p.click('[data-act="edit"]'); await p.waitForTimeout(300);
await p.fill('#fTitle',"Obtenir la carte d'identité");
await p.click('#saveCase'); await p.waitForTimeout(400);
await p.click('[data-lang="he"]'); await p.waitForTimeout(400);
ok('retyping the template name re-enables auto', (await T())===he);

// --- legacy data recorded with a frozen title gets migrated ---
await p.evaluate(()=>localStorage.setItem('klaser.v1',JSON.stringify({lang:'he',cases:[
 {id:'z',title:'Get an Israeli ID card',template:'teudat_zehut',agency:'rashut',status:'todo',
  ref:'',opened:'2026-08-01',deadline:'',open:false,docs:[],notes:[]},
 {id:'y',title:'משהו שכתבתי בעצמי',template:null,agency:'btl',status:'todo',
  ref:'',opened:'2026-08-01',deadline:'',open:false,docs:[],notes:[]}]})));
await p.reload(); await p.waitForTimeout(400);
const titles = await p.$$eval('.case-title', e=>e.map(x=>x.textContent.trim()));
ok('legacy template title migrated to Hebrew', titles.includes('הנפקת תעודת זהות'));
ok('legacy custom title left alone', titles.includes('משהו שכתבתי בעצמי'));
await p.click('[data-lang="ru"]'); await p.waitForTimeout(400);
const ru = await p.$$eval('.case-title', e=>e.map(x=>x.textContent.trim()));
ok('migrated one now follows language', ru.includes('Получить удостоверение личности'));
ok('custom one still untouched', ru.includes('משהו שכתבתי בעצמי'));

// --- a case with no template falls back to the agency name ---
await p.evaluate(()=>{ cases=[{id:'w',title:'',template:null,agency:'btl',status:'todo',
  ref:'',opened:'2026-08-01',deadline:'',open:false,docs:[],notes:[]}]; save(); render(); });
await p.waitForTimeout(300);
ok('untitled case names itself after the agency (ru)', (await T())==='Институт национального страхования');
await p.click('[data-lang="he"]'); await p.waitForTimeout(300);
ok('...and follows to Hebrew', (await T())==='ביטוח לאומי');
console.log(errs.length?'ERRORS: '+errs.join(' | '):'No console/page errors.');
await b.close();
