import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
async function newCase(page){
  // the toolbar button is hidden while the list is empty; the empty card owns the action
  if(await page.isVisible('#emptyNew')) await page.click('#emptyNew');
  else await page.click('#newCase');
}
const errors=[];
const browser = await chromium.launch();
const ctx = await browser.newContext({viewport:{width:430,height:900}});
const page = await ctx.newPage();
page.on('pageerror', e=>errors.push('PAGEERROR: '+e.message));
page.on('console', m=>{ if(m.type()==='error') errors.push('CONSOLE: '+m.text()); });
const ok=(l,c)=>console.log((c?'PASS  ':'FAIL  ')+l);

await page.goto('file:///workspace/klaser-test/index.html');
await page.waitForTimeout(300);

// create a case with template docs
await newCase(page);
await page.selectOption('#fTemplate','license');
await page.click('#saveCase');
await page.waitForTimeout(200);
ok('case created', (await page.$$('.doc')).length===4);
ok('attach buttons present', (await page.$$('.doc [data-act="attach"]')).length===4);

// build a real JPEG in-page and feed it to the picker
const png = Buffer.from(
 'iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAAcElEQVR4nO3QMQ0AAAjAMPBvGjyIQU'+
 'sSCz0dAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'+
 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgZQGZWgABhKr7CQAAAABJRU5ErkJggg==','base64');
await page.setInputFiles('#scanInput', {name:'teudat.png', mimeType:'image/png', buffer:png});
await page.waitForTimeout(100);
// the picker only knows its target after the attach button sets `pending`
await page.evaluate(()=>{}); 
ok('no scan without target', (await page.$$('.thumb:not(.add)')).length===0);

// proper flow: click attach first
await page.click('.doc-wrap:first-child [data-act="attach"]');
await page.setInputFiles('#scanInput', {name:'teudat.png', mimeType:'image/png', buffer:png});
await page.waitForTimeout(600);
ok('thumbnail added', (await page.$$('.thumb:not(.add)')).length===1);

// stored in IndexedDB, not localStorage
const inLS = await page.evaluate(()=>localStorage.getItem('klaser.v1').length);
ok('localStorage stays small (<2KB)', inLS < 2000);
const metaOk = await page.evaluate(()=>{
  const d=JSON.parse(localStorage.getItem('klaser.v1'));
  const sc=d.cases[0].docs[0].scans[0];
  return !!(sc && sc.id && sc.size>0 && sc.name==='teudat.png');
});
ok('metadata recorded on record', metaOk);

// survives reload
await page.reload(); await page.waitForTimeout(700);
ok('thumbnail persists after reload', (await page.$$('.thumb:not(.add)')).length===1);
const painted = await page.evaluate(()=>{
  const el=document.querySelector('.thumb:not(.add)');
  return el && /^url\(/.test(getComputedStyle(el).backgroundImage);
});
ok('thumbnail image painted from IDB', painted);

// viewer opens
await page.click('.thumb:not(.add)');
await page.waitForTimeout(400);
ok('viewer opens', await page.getAttribute('#scanModal','data-open')==='1');
ok('viewer shows image', await page.isVisible('#scanImg'));
ok('viewer meta shown', (await page.textContent('#scanMeta')).includes('teudat.png'));

// second scan on same doc
await page.click('#scanClose');
await page.click('.doc-wrap:first-child [data-act="attach"]');
await page.setInputFiles('#scanInput', {name:'second.png', mimeType:'image/png', buffer:png});
await page.waitForTimeout(600);
ok('two scans on one doc', (await page.$$('.thumb:not(.add)')).length===2);

// delete one via viewer
await page.click('.thumb:not(.add)');
await page.waitForTimeout(300);
page.once('dialog', d=>d.accept());
await page.click('#scanDelete');
await page.waitForTimeout(500);
ok('scan deleted', (await page.$$('.thumb:not(.add)')).length===1);
const idbCount = await page.evaluate(()=>new Promise(res=>{
  const r=indexedDB.open('klaser',1);
  r.onsuccess=()=>{ const tx=r.result.transaction('scans','readonly');
    const q=tx.objectStore('scans').getAllKeys(); q.onsuccess=()=>res(q.result.length); };
}));
ok('blob removed from IndexedDB too', idbCount===1);

// deleting the document cleans up its scans
page.once('dialog', d=>d.accept());
await page.click('.doc-wrap:first-child [data-act="rmdoc"]');
await page.waitForTimeout(600);
const idbAfter = await page.evaluate(()=>new Promise(res=>{
  const r=indexedDB.open('klaser',1);
  r.onsuccess=()=>{ const tx=r.result.transaction('scans','readonly');
    const q=tx.objectStore('scans').getAllKeys(); q.onsuccess=()=>res(q.result.length); };
}));
ok('orphaned blob cleaned on doc delete', idbAfter===0);
ok('no thumbs left', (await page.$$('.thumb:not(.add)')).length===0);

console.log(errors.length ? '\nERRORS:\n'+errors.join('\n') : '\nNo console/page errors.');
await browser.close();
