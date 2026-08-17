import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
async function newCase(page){
  // the toolbar button is hidden while the list is empty; the empty card owns the action
  if(await page.isVisible('#emptyNew')) await page.click('#emptyNew');
  else await page.click('#newCase');
}
const errors=[]; const browser=await chromium.launch();
const ctx=await browser.newContext({acceptDownloads:true}); const page=await ctx.newPage();
page.on('pageerror',e=>errors.push('PAGEERROR: '+e.message));
const ok=(l,c)=>console.log((c?'PASS  ':'FAIL  ')+l);
await page.goto('file:///workspace/klaser-test/index.html');
await page.waitForTimeout(300);
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAAcElEQVR4nO3QMQ0AAAjAMPBvGjyIQU'+
 'sSCz0dAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'+
 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgZQGZWgABhKr7CQAAAABJRU5ErkJggg==','base64');
await newCase(page); await page.selectOption('#fTemplate','license'); await page.click('#saveCase');
await page.waitForTimeout(200);
await page.click('.doc-wrap:first-child [data-act="attach"]');
await page.setInputFiles('#scanInput',{name:'a.png',mimeType:'image/png',buffer:png});
await page.waitForTimeout(600);
ok('scan attached', (await page.$$('.thumb:not(.add)')).length===1);

// export WITH scans
page.once('dialog', d=>{ console.log('      prompt: '+d.message().split('\n')[0]); d.accept(); });
const dl = await Promise.all([page.waitForEvent('download'), page.click('#exportBtn')]);
const path = await dl[0].path();
const json = JSON.parse((await import('fs')).readFileSync(path,'utf8'));
ok('backup contains scanData', !!json.scanData && Object.keys(json.scanData).length===1);
ok('backup embeds a data URL', Object.values(json.scanData)[0].startsWith('data:image/'));

// wipe everything, then restore
await page.evaluate(()=>new Promise(res=>{
  localStorage.clear();
  const r=indexedDB.deleteDatabase('klaser'); r.onsuccess=()=>res(); r.onerror=()=>res(); r.onblocked=()=>res();
}));
await page.reload(); await page.waitForTimeout(400);
ok('wiped clean', (await page.$$('.case')).length===0);

page.once('dialog', d=>d.accept());
await page.setInputFiles('#importFile', path);
await page.waitForTimeout(900);
ok('case restored', (await page.$$('.case')).length===1);
await page.waitForTimeout(400);
ok('thumbnail restored', (await page.$$('.thumb:not(.add)')).length===1);
const painted=await page.evaluate(()=>{const e=document.querySelector('.thumb:not(.add)');
  return e && /^url\(/.test(getComputedStyle(e).backgroundImage);});
ok('restored image renders from IDB', painted);
console.log(errors.length?'\nERRORS:\n'+errors.join('\n'):'\nNo page errors.');
await browser.close();
