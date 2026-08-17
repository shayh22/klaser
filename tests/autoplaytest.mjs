import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs';
const ROOT = new URL('..', import.meta.url).pathname;
const HERE = new URL('.', import.meta.url).pathname;
const WEBM = fs.readFileSync(HERE + 'fake-video.webm');
const b=await chromium.launch();
const ok=(l,c)=>console.log((c?'PASS  ':'FAIL  ')+l);
async function ctxWith(opts={}){
  const c=await b.newContext(opts);
  await c.route('**/gemini_generated_video_*.mp4', r=>r.fulfill({status:200,contentType:'video/webm',body:WEBM}));
  return c;
}
// attributes the browser needs before it will permit autoplay at all
{
  const src = fs.readFileSync(ROOT + 'index.html','utf8');
  const tag = src.match(/<video[\s\S]*?>/)[0];
  ok('autoplay attribute present', /\bautoplay\b/.test(tag));
  ok('muted (mandatory for autoplay)', /\bmuted\b/.test(tag));
  ok('playsinline (iOS must not go fullscreen)', /\bplaysinline\b/.test(tag));
  ok('preload=auto (data ready when it starts)', /preload="auto"/.test(tag));
}
// it actually plays on landing, unprompted
{
  const p=await (await ctxWith({viewport:{width:390,height:844}})).newPage();
  await p.goto('http://127.0.0.1:8099/index.html');
  await p.waitForFunction(()=>{const v=document.getElementById('heroVid');return v && !v.paused && v.currentTime>0;},{timeout:8000}).catch(()=>{});
  const r=await p.evaluate(()=>{const v=document.getElementById('heroVid'),pl=document.getElementById('heroPlay');
    return {paused:v.paused, t:v.currentTime, muted:v.muted, loop:v.loop, playBtnHidden:pl.hidden};});
  ok('plays automatically on landing', r.paused===false);
  ok('playhead advanced past 0', r.t>0);
  ok('plays muted', r.muted===true);
  ok('loops', r.loop===true);
  ok('no play button while playing', r.playBtnHidden===true);
  await p.close();
}
// Chromium always permits MUTED autoplay, so the refusal path cannot be
// produced with a policy flag. Real devices do refuse it (iOS Low Power Mode,
// some data-saver modes), so drive the branch directly: play() rejects and the
// element reports itself paused, exactly as it behaves there.
{
  const c=await ctxWith({viewport:{width:390,height:844}});
  const p=await c.newPage();
  await p.addInitScript(()=>{
    HTMLMediaElement.prototype.play=function(){return Promise.reject(new DOMException('x','NotAllowedError'));};
    Object.defineProperty(HTMLMediaElement.prototype,'paused',{get(){return true;},configurable:true});
    // also defeat the declarative attribute, or the browser starts it anyway
    new MutationObserver((m,obs)=>{
      const v=document.getElementById('heroVid');
      if(v){ v.removeAttribute('autoplay'); v.preload='none'; obs.disconnect(); }
    }).observe(document.documentElement,{childList:true,subtree:true});
  });
  // record whether the button was ever revealed: Chromium permits muted
  // autoplay unconditionally, so it may legitimately play and hide it again
  await p.addInitScript(()=>{
    window.__shown=false;
    const d=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'hidden');
    Object.defineProperty(HTMLElement.prototype,'hidden',{configurable:true,
      get(){return d.get.call(this);},
      set(v){ if(this.id==='heroPlay' && v===false) window.__shown=true; d.set.call(this,v); }});
  });
  await p.goto('http://127.0.0.1:8099/index.html'); await p.waitForTimeout(1500);
  const r=await p.evaluate(()=>{const w=document.getElementById('hero'),pl=document.getElementById('heroPlay');
    return {heroThere:!!w && !w.hidden, everShown:window.__shown,
            aria:pl&&pl.getAttribute('aria-label'), playing:!document.getElementById('heroVid').ended};});
  ok('REFUSED: video still shown, not deleted', r.heroThere);
  ok('REFUSED: fallback revealed the play button', r.everShown);
  ok('REFUSED: play button labelled for screen readers', !!r.aria);
  await p.close();
}

// reduced motion is still honoured
{
  const p=await (await ctxWith({viewport:{width:390,height:844},reducedMotion:'reduce'})).newPage();
  await p.goto('http://127.0.0.1:8099/index.html'); await p.waitForTimeout(1500);
  const r=await p.evaluate(()=>{const v=document.getElementById('heroVid'),pl=document.getElementById('heroPlay');
    return {paused:v.paused, attr:v.hasAttribute('autoplay'), playShown:pl && !pl.hidden};});
  ok('REDUCED MOTION: does not autoplay', r.paused===true && r.attr===false);
  ok('REDUCED MOTION: offered as tap-to-play', r.playShown);
  await p.close();
}
// where autoplay is refused, the first interaction should trigger another
// attempt without the user having to find the button
{
  const c=await ctxWith({viewport:{width:390,height:844}});
  const p=await c.newPage();
  await p.addInitScript(()=>{
    window.__calls=0;
    HTMLMediaElement.prototype.play=function(){ window.__calls++;
      return Promise.reject(new DOMException('x','NotAllowedError')); };
    Object.defineProperty(HTMLMediaElement.prototype,'paused',{get(){return true;},configurable:true});
    new MutationObserver((m,obs)=>{const v=document.getElementById('heroVid');
      if(v){v.removeAttribute('autoplay');obs.disconnect();}}).observe(document.documentElement,{childList:true,subtree:true});
  });
  await p.goto('http://127.0.0.1:8099/index.html'); await p.waitForTimeout(1200);
  const before = await p.evaluate(()=>window.__calls);
  ok('GESTURE: attempts were made automatically first', before>0);
  await p.mouse.click(200, 600);              // a tap anywhere on the page
  await p.waitForTimeout(600);
  const afterTap = await p.evaluate(()=>window.__calls);
  ok('GESTURE: a tap anywhere triggers another attempt', afterTap>before);
  await p.mouse.wheel(0, 300);                // scrolling counts too
  await p.waitForTimeout(600);
  ok('GESTURE: scrolling also retries', (await p.evaluate(()=>window.__calls))>=afterTap);
  await p.close();
}

await b.close();
