import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const b=await chromium.launch(); const errs=[];
const ctx=await b.newContext({viewport:{width:375,height:812}});
const p=await ctx.newPage();
p.on('pageerror',e=>errs.push(String(e.message)));
p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
const ok=(l,c)=>console.log((c?'PASS  ':'FAIL  ')+l);
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAAcElEQVR4nO3QMQ0AAAjAMPBvGjyIQU'+
 'sSCz0dAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'+
 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgZQGZWgABhKr7CQAAAABJRU5ErkJggg==','base64');

await p.goto('http://127.0.0.1:8099/index.html'); await p.waitForTimeout(400);

// ---- agency phone numbers ----
await p.click('[data-tab="agencies"]'); await p.waitForTimeout(400);
const dir = await p.textContent('#agencyList');
ok('short code present',  dir.includes('*6050'));
ok('landline present',    dir.includes('04-8812345'));
ok('all 6 landlines',     ['04-8812345','074-7083450','03-9733333','02-5656400','03-5086905','073-3983960'].every(x=>dir.includes(x)));
ok('abroad note shown',   (await p.textContent('#view-agencies')).includes('כוכבית'));
const telHref = await p.getAttribute('#agencyList a[href^="tel:+972"]','href');
ok('intl tel: strips leading 0 and adds +972', telHref==='tel:+97248812345');

// ---- share ----
await p.click('[data-tab="cases"]'); await p.waitForTimeout(300);
ok('share button present', await p.isVisible('#shareBtn'));
const sb=await (await p.$('#shareBtn')).boundingBox();
ok('share button >=44px', sb.height>=44);
// no navigator.share in headless -> should fall back to wa.me
// wa.me is blocked by this sandbox's egress proxy, so the opened page never
// loads; assert on the call the app makes rather than on the third party
await p.evaluate(()=>{ window.__opened=null; window.open=(u,t,f)=>{ window.__opened={u,t,f}; return null; }; });
await p.click('#shareBtn'); await p.waitForTimeout(400);
const op = await p.evaluate(()=>window.__opened);
ok('falls back to WhatsApp', !!op && op.u.startsWith('https://wa.me/?text='));
ok('share text carries the URL', !!op && decodeURIComponent(op.u).includes('127.0.0.1'));
ok('opens with noopener', !!op && op.f==='noopener');

// ---- case-level scans ----
await p.click('.qbtn'); await p.waitForTimeout(500);
ok('received section present', (await p.textContent('.case-body')).includes('מה שקיבלתי מהרשות'));
ok('add tile present', await p.isVisible('.thumb.add'));
const ab=await (await p.$('.thumb.add')).boundingBox();
ok('add tile >=44px', ab.width>=44 && ab.height>=44);
await p.click('.thumb.add');
await p.setInputFiles('#scanInput',{name:'letter.png',mimeType:'image/png',buffer:png});
await p.waitForTimeout(800);
ok('case scan attached', (await p.$$('.case-scans .thumb:not(.add)')).length===1);
ok('stored on the case, not a document', await p.evaluate(()=>{
  const d=JSON.parse(localStorage.getItem('klaser.v1'));
  return (d.cases[0].scans||[]).length===1 && d.cases[0].docs.every(x=>!(x.scans||[]).length); }));
await p.click('.case-scans .thumb:not(.add)'); await p.waitForTimeout(400);
ok('case scan opens in viewer', await p.getAttribute('#scanModal','data-open')==='1');
ok('viewer shows the image', await p.isVisible('#scanImg'));
p.once('dialog',d=>d.accept());
await p.click('#scanDelete'); await p.waitForTimeout(600);
ok('case scan deleted', (await p.$$('.case-scans .thumb:not(.add)')).length===0);
const idb=await p.evaluate(()=>new Promise(r=>{const q=indexedDB.open('klaser',1);
  q.onsuccess=()=>{const t=q.result.transaction('scans','readonly').objectStore('scans').getAllKeys();
  t.onsuccess=()=>r(t.result.length);};}));
ok('blob removed from IndexedDB', idb===0);
// deleting the case cleans case-level scans
await p.click('.thumb.add');
await p.setInputFiles('#scanInput',{name:'x.png',mimeType:'image/png',buffer:png});
await p.waitForTimeout(700);
p.once('dialog',d=>d.accept());
await p.click('[data-act="del"]'); await p.waitForTimeout(800);
const idb2=await p.evaluate(()=>new Promise(r=>{const q=indexedDB.open('klaser',1);
  q.onsuccess=()=>{const t=q.result.transaction('scans','readonly').objectStore('scans').getAllKeys();
  t.onsuccess=()=>r(t.result.length);};}));
ok('case delete cleans its scans', idb2===0);
console.log(errs.length?'ERRORS: '+errs.join(' | '):'No console/page errors.');
await b.close();
