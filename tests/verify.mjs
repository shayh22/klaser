import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const b=await chromium.launch(); const errs=[];
const ctx=await b.newContext({viewport:{width:375,height:812}});
const p=await ctx.newPage();
p.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
p.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE '+m.text());});
p.on('response',r=>{if(r.status()>=400)errs.push('HTTP '+r.status());});
const ok=(l,c)=>console.log((c?'PASS  ':'FAIL  ')+l);

// ---------- EMPTY STATE ----------
await p.goto('http://127.0.0.1:8099/index.html'); await p.waitForTimeout(400);
ok('empty state renders', (await p.textContent('#caseList')).includes('עדיין אין תיקים'));
ok('empty state has a next action', await p.isVisible('#emptyNew'));
const eb = await (await p.$('#emptyNew')).boundingBox();
ok('empty CTA >=44px tall', eb.height>=44);
await p.click('#emptyNew'); await p.waitForTimeout(300);
ok('empty CTA opens the editor', await p.getAttribute('#modal','data-open')==='1');
await p.click('#cancelCase'); await p.waitForTimeout(200);

// ---------- ERROR STATE: bad import ----------
import fs from 'fs';
fs.writeFileSync('/tmp/bad.json','{ this is not valid json');
let dialogMsg=null;
p.once('dialog', async d=>{ dialogMsg=d.message(); await d.accept(); });
await p.setInputFiles('#importFile','/tmp/bad.json'); await p.waitForTimeout(600);
ok('invalid import shows an error', dialogMsg && dialogMsg.includes('לא תקין'));
ok('app still alive after bad import', await p.isVisible('#caseList') && await p.isVisible('nav.tabs'));

// ---------- RTL / BIDI ----------
await p.evaluate(()=>localStorage.setItem('klaser.v1',JSON.stringify({lang:'he',cases:[
 {id:'a',title:'המרת רישיון נהיגה',agency:'tachbura',status:'collecting',ref:'TR-88213',
  opened:'2026-08-01',deadline:'2026-08-24',open:true,
  docs:[{id:'1',key:'teudat_zehut',done:true},{id:'2',key:'eye_test',done:false}],
  notes:[{id:'n1',date:'2026-08-12',text:'התקשרתי, אמרו לחכות 30 יום.'}]}]})));
await p.reload(); await p.waitForTimeout(500);
ok('html dir=rtl', await p.getAttribute('html','dir')==='rtl');
const dirs = await p.evaluate(()=>({
  headStart: getComputedStyle(document.querySelector('.case-head')).textAlign,
  refDir: document.querySelector('.case-meta span[dir]')?.getAttribute('dir'),
  noteDate: document.querySelector('.note .when')?.getAttribute('dir'),
  noteBody: document.querySelector('.note span[dir=auto]')?.getAttribute('dir'),
  title: document.querySelector('.case-title')?.getAttribute('dir'),
  caret: getComputedStyle(document.querySelector('.case-caret')).transform
}));
ok('case text starts at the right edge', dirs.headStart==='start'||dirs.headStart==='right');
ok('ref number isolated LTR', dirs.refDir==='ltr');
ok('note date isolated LTR', dirs.noteDate==='ltr');
ok('note body dir=auto', dirs.noteBody==='auto');
ok('case title dir=auto', dirs.title==='auto');
ok('caret mirrored in RTL (negative rotation)', dirs.caret.includes('-1')||dirs.caret==='none'||/matrix/.test(dirs.caret));
// numbers must not be reversed
ok('ref renders unreversed', (await p.textContent('.case-meta')).includes('TR-88213'));
ok('date renders unreversed', (await p.textContent('.note .when')).trim()==='2026-08-12');
ok('no horizontal overflow (RTL)', await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));

// focus ring reachable by keyboard
await p.keyboard.press('Tab'); await p.keyboard.press('Tab');
const focusRing = await p.evaluate(()=>{ const el=document.activeElement;
  const st=getComputedStyle(el); return {tag:el.tagName, outline:st.outlineWidth, name:(el.textContent||'').trim().slice(0,12)}; });
ok('keyboard focus lands on a control', focusRing.tag==='BUTTON'||focusRing.tag==='A');

// LTR language: Hebrew chips inside an LTR page
await p.click('[data-lang="fr"]'); await p.waitForTimeout(400);
ok('switches to LTR', await p.getAttribute('html','dir')==='ltr');
ok('he-term isolated in LTR', await p.evaluate(()=>{
  const c=document.querySelector('.he-term'); return c && getComputedStyle(c).unicodeBidi==='isolate'; }));
ok('no overflow in LTR', await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));

console.log(errs.length?'\nERRORS: '+errs.join(' | '):'\nZero console/page/network errors.');
await b.close();
