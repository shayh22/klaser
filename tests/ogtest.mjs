import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs';
const ROOT = new URL('..', import.meta.url).pathname;
const b=await chromium.launch(); const p=await (await b.newContext()).newPage();
const ok=(l,c)=>console.log((c?'PASS  ':'FAIL  ')+l);
const reqs=[]; p.on('request',r=>reqs.push(r.url()));
await p.goto('http://127.0.0.1:8099/index.html'); await p.waitForTimeout(400);
const m = await p.evaluate(()=>{
  const g=n=>document.querySelector(`meta[property="${n}"]`)?.content
        || document.querySelector(`meta[name="${n}"]`)?.content || null;
  return {img:g('og:image'), w:g('og:image:width'), h:g('og:image:height'),
          url:g('og:url'), alt:g('og:image:alt'), title:g('og:title'),
          card:g('twitter:card'), tw:g('twitter:image')};
});
ok('og:image present', !!m.img);
ok('og:image is absolute', m.img && m.img.startsWith('https://'));
ok('og:url present', !!m.url);
ok('dimensions declared', m.w==='1200' && m.h==='671');
ok('alt text present', !!m.alt);
ok('twitter large card', m.card==='summary_large_image' && !!m.tw);
const st = fs.statSync(ROOT + 'docs/og-image.jpg');
ok('preview under 300KB (WhatsApp renders it)', st.size < 300*1024);
console.log(`      preview: ${(st.size/1024).toFixed(0)} KB`);
ok('page still makes no external request', reqs.every(u=>u.startsWith('http://127.0.0.1:8099')));
// the referenced file must actually exist at the served path
const r = await p.goto('http://127.0.0.1:8099/docs/og-image.jpg');
ok('image resolves at its published path', r.status()===200);
await b.close();
