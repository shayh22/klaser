import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:375,height:812}});
// the real site is blocked by the sandbox proxy; intercept so we can see the
// navigation actually being attempted, and from which element
await ctx.route('**birkat-hanasi.lovable.app/**', r=>r.fulfill({status:200,body:'<h1>ok</h1>',contentType:'text/html'}));
const p=await ctx.newPage();
const ok=(l,c)=>console.log((c?'PASS  ':'FAIL  ')+l);
const errs=[]; p.on('pageerror',e=>errs.push(String(e.message)));

for(const [label,sel] of [['logo image','#credit img'],
                          ['"פותח על ידי" label','#credit .c-lead'],
                          ['company name','#credit .c-name'],
                          ['transliteration','#credit .c-tr'],
                          ['tagline','#credit .c-tag']]){
  await p.goto('http://127.0.0.1:8099/index.html'); await p.waitForTimeout(350);
  const newPage = ctx.waitForEvent('page',{timeout:6000}).catch(()=>null);
  await p.click(sel);
  const np = await newPage;
  const url = np ? np.url() : null;
  ok(`click on ${label} → opens the site`, url && url.startsWith('https://birkat-hanasi.lovable.app'));
  if(np) await np.close();
}
console.log(errs.length?'ERRORS: '+errs.join(' | '):'No page errors.');
await b.close();
