import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const b=await chromium.launch(); const errs=[]; const reqs=[];
const p=await (await b.newContext({viewport:{width:375,height:812}})).newPage();
p.on('pageerror',e=>errs.push(String(e.message)));
p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
p.on('request',r=>reqs.push(r.url()));
const ok=(l,c)=>console.log((c?'PASS  ':'FAIL  ')+l);
await p.goto('http://127.0.0.1:8099/index.html'); await p.waitForTimeout(400);

ok('credit block renders', await p.isVisible('#credit'));
const txt = await p.textContent('#credit');
ok('company name shown', txt.includes('ברכת הנשיא'));
ok('transliteration shown', txt.includes('Birkat HaNasi'));
ok('tagline shown (he)', txt.includes('במהירות הבזק'));
ok('"built by" label shown', txt.includes('פותח על ידי'));

// tagline follows the interface language
for(const [l,frag] of [['fr','vitesse de l’éclair'],['en','powered by AI'],['ru','молниеносно']]){
  await p.click(`[data-lang="${l}"]`); await p.waitForTimeout(300);
  ok(`${l}: tagline translated`, (await p.textContent('#credit')).includes(frag));
  ok(`${l}: company name stays Hebrew`, (await p.textContent('#credit')).includes('ברכת הנשיא'));
}
await p.click('[data-lang="he"]'); await p.waitForTimeout(300);

// the company name links to the developer's site
const href = await p.$eval('#credit a.credit-link', e=>e.getAttribute('href'));
ok('name links to the company site', href==='https://birkat-hanasi.lovable.app');
ok('link opens new tab, noopener', await p.$eval('#credit a.credit-link', e=>e.target==='_blank'&&e.rel.includes('noopener')));
ok('link contains the company name', (await p.textContent('#credit a.credit-link')).includes('ברכת הנשיא'));
// every part of the block must reach the site
for(const sel of ['#credit img','#credit .c-lead','#credit .c-name','#credit .c-tr','#credit .c-tag']){
  const inside = await p.$eval(sel, e=>!!e.closest('a.credit-link'));
  ok('clickable: '+sel.replace('#credit ',''), inside);
}
const cb = await (await p.$('a.credit-link')).boundingBox();
ok('whole block is a large target', cb.height>=44 && cb.width>=200);
ok('link is labelled for screen readers', await p.$eval('a.credit-link', e=>(e.getAttribute('aria-label')||'').includes('ברכת הנשיא')));
ok('logo alt empty (anchor carries the name)', await p.$eval('#credit img', e=>e.getAttribute('alt')===''));
// and the no-url fallback still degrades to plain text
await p.evaluate(()=>{ const u=CREDIT.url; CREDIT.url=''; renderCredit(); window.__u=u; });
await p.waitForTimeout(200);
ok('empty url -> plain text, no dead link', (await p.$$('#credit a')).length===0);
await p.evaluate(()=>{ CREDIT.url=window.__u; renderCredit(); });
await p.waitForTimeout(200);
// the privacy property must survive
ok('still zero external requests', reqs.every(u=>u.startsWith('http://127.0.0.1:8099')));
ok('logo renders from config', (await p.$$('#credit img')).length===1);
ok('logo is an embedded data URI', await p.$eval('#credit img', e=>e.src.startsWith('data:image/')));
ok('logo decodes (non-zero natural size)', await p.$eval('#credit img', e=>e.naturalWidth>0));
ok('no horizontal overflow', await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));

// once url + logo are configured
await p.evaluate(()=>renderCredit());
await p.waitForTimeout(300);
const a = await p.$('#credit a.credit-link');
ok('link still present with logo', !!a);
ok('link opens in new tab with noopener', await p.$eval('#credit a.credit-link', e=>e.target==='_blank'&&e.rel.includes('noopener')));
ok('logo renders when set', (await p.$$('#credit img')).length===1);

const bb = await (await p.$('#credit img')).boundingBox();
ok('logo sized sensibly', bb.width<=48 && bb.height<=48);
ok('data: logo makes no network request', reqs.every(u=>u.startsWith('http://127.0.0.1:8099')));
console.log(errs.length?'ERRORS: '+errs.join(' | '):'No console/page errors.');
await b.close();
