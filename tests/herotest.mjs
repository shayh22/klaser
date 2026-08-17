import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const HERE = new URL('.', import.meta.url).pathname;
const b=await chromium.launch();
const ok=(l,c)=>console.log((c?'PASS  ':'FAIL  ')+l);
const WEBM = (await import('fs')).readFileSync(HERE + 'fake-video.webm');
async function serveDecodable(ctx){
  await ctx.route('**/gemini_generated_video_*.mp4', r =>
    r.fulfill({status:200, contentType:'video/webm', body:WEBM}));
}

// this build has no H.264, so the video errors -> the genuine-failure path
{
  const p=await (await b.newContext({viewport:{width:375,height:812}})).newPage();
  await p.goto('http://127.0.0.1:8099/index.html'); await p.waitForTimeout(1500);
  ok('LOAD FAILURE: falls back to the text title', await p.isVisible('#appH1'));
  ok('LOAD FAILURE: hero removed', (await p.$$('#hero')).length===0);
  ok('LOAD FAILURE: no overflow', await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await p.close();
}
// (autoplay behaviour — allowed, refused, and the play-button fallback — is
//  owned by autoplaytest.mjs, which stubs both play() and paused deterministically)

// reduced motion: visible, playable, just not automatic
{
  const c3=await b.newContext({viewport:{width:375,height:812},reducedMotion:'reduce'}); await serveDecodable(c3);
  const p=await c3.newPage();
  await p.addInitScript(()=>{ HTMLMediaElement.prototype.play = function(){ return Promise.resolve(); }; });
  await p.goto('http://127.0.0.1:8099/index.html'); await p.waitForTimeout(1000);
  const r = await p.evaluate(()=>{
    const w=document.getElementById('hero'), pl=document.getElementById('heroPlay');
    return {visible:w&&!w.hidden, play:pl&&!pl.hidden};
  });
  ok('REDUCED MOTION: hero still shown', r.visible);
  ok('REDUCED MOTION: offered as tap-to-play', r.play);
  await p.close();
}
// autoplay allowed: plays, no button, h1 replaced but present
{
  const c4=await b.newContext({viewport:{width:375,height:812}}); await serveDecodable(c4);
  const p=await c4.newPage();
  await p.addInitScript(()=>{ HTMLMediaElement.prototype.play = function(){ return Promise.resolve(); }; });
  await p.goto('http://127.0.0.1:8099/index.html'); await p.waitForTimeout(1000);
  const r = await p.evaluate(()=>{
    const w=document.getElementById('hero'), pl=document.getElementById('heroPlay'), h=document.getElementById('appH1');
    return {visible:w&&!w.hidden, playHidden:pl&&pl.hidden,
            h1InDom:!!h, h1Replaced:h&&h.classList.contains('replaced'), h1Text:h&&h.textContent};
  });
  ok('AUTOPLAY OK: hero visible', r.visible);
  ok('AUTOPLAY OK: no play button', r.playHidden);
  ok('AUTOPLAY OK: h1 kept in DOM for screen readers', r.h1InDom && r.h1Text.includes('קלסר'));
  ok('AUTOPLAY OK: h1 visually replaced', r.h1Replaced);
  await p.close();
}
// poster must actually resolve
{
  const p=await (await b.newContext()).newPage();
  const r=await p.goto('http://127.0.0.1:8099/docs/hero-poster.jpg');
  ok('poster serves 200', r.status()===200);
  await p.close();
}
await b.close();
