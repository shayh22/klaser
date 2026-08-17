import { createApp } from '../server/index.js';
import { readFileSync } from 'node:fs';
const catalogue = JSON.parse(readFileSync(new URL('../contracts/catalogue.json', import.meta.url).pathname,'utf8'));
const app = createApp({ catalogue, env:{} });
const B = s => Buffer.from(s).toString('base64');
const call = (path, opts={}) => app(new Request('http://x'+path, opts));

let pass=0, fail=0;
const ok=(c,m)=>{ c?pass++:(fail++,console.log('  FAIL '+m)); };

const h = await (await call('/v1/health')).json();
ok(h.status==='ok','health ok'); ok(h.provider==='mock','mock provider'); ok(h.accepts_analysis===true,'accepting');

const tok = await (await call('/v1/token',{method:'POST',body:'{}'})).json();
ok(!!tok.token,'token issued'); ok(tok.quota.limit===10,'10 credits'); ok(tok.quota.remaining===10,'10 remaining');

const A = (img, extra={}) => call('/v1/analyze',{method:'POST',
  headers:{authorization:'Bearer '+tok.token,'content-type':'application/json'},
  body:JSON.stringify({image:img, consent:{granted_at:new Date().toISOString(),scope:'single_document'}, ...extra})});

// no consent
const nc = await call('/v1/analyze',{method:'POST',headers:{authorization:'Bearer '+tok.token},body:JSON.stringify({image:B('x')})});
ok(nc.status===400,'consent required'); ok((await nc.json()).error.code==='consent_missing','consent_missing code');

// bad token
const bt = await call('/v1/analyze',{method:'POST',headers:{authorization:'Bearer nope'},body:'{}'});
ok(bt.status===401,'bad token 401');

// happy path
const r1 = await (await A(B('a photo'))).json();
ok(r1.result.agency==='btl','agency btl');
ok(r1.result.template==='child_allowance','template matched');
ok(r1.result.required_docs.length===4,'4 required docs');
ok(r1.result.required_docs.every(d=>d.evidence),'every doc has evidence');
ok(r1.result.extra_docs.length===1,'1 extra doc');
ok(r1.result.form_to_fill.where==='self','form is in the same document');
ok(r1.meta.source==='model','source=model');
ok(r1.meta.credits_charged===1,'charged 1 credit');
ok(r1.meta.quota.remaining===9,'9 remaining');
ok(!!r1.meta.form_signature,'signature returned');
ok(r1.meta.form_signature.length===24,'signature is 12 bytes hex');

// not a letter -> free
const r2 = await (await A(B('KLASER-MOCK:'+JSON.stringify({identify:{is_letter:false}})))).json();
ok(r2.result.not_a_letter===true,'not_a_letter');
ok(r2.meta.credits_charged===0,'not-a-letter is free');
ok(r2.meta.quota.remaining===9,'quota untouched');

// low confidence -> nothing proposed, nothing charged
const r3 = await (await A(B('KLASER-MOCK:'+JSON.stringify({read:{confidence:0.2}})))).json();
ok(r3.result.required_docs.length===0,'low confidence proposes nothing');
ok(r3.meta.credits_charged===0,'low confidence is free');

// signature is stable and impersonal
const s1 = r1.meta.form_signature;
const r4 = await (await A(B('KLASER-MOCK:'+JSON.stringify({read:{reference:'999-000-1'}})))).json();
ok(r4.meta.form_signature===s1,'signature stable across different reference numbers');

// upstream failure
const r5 = await A(B('KLASER-MOCK:'+JSON.stringify({fail:true})));
ok(r5.status===503,'upstream failure -> 503');
ok((await r5.json()).error.message_he.length>0,'error carries hebrew message');

// quota exhaustion
const t2 = await (await call('/v1/token',{method:'POST',body:'{}'})).json();
const A2 = img => call('/v1/analyze',{method:'POST',headers:{authorization:'Bearer '+t2.token},
  body:JSON.stringify({image:img,consent:{granted_at:'x',scope:'single_document'}})});
for(let i=0;i<10;i++) await A2(B('photo '+i));
const ex = await A2(B('one too many'));
ok(ex.status===429,'quota exhausted -> 429');
ok((await ex.json()).error.code==='quota_exhausted','quota_exhausted code');

// kill switch
const app2 = createApp({ catalogue, env:{ KILL_SWITCH:'1' } });
const h2 = await (await app2(new Request('http://x/v1/health'))).json();
ok(h2.status==='degraded','kill switch degrades health');
ok(h2.accepts_analysis===false,'kill switch stops accepting');

// image too large
const big = 'A'.repeat(6*1024*1024);
const lg = await A(big);
ok(lg.status===413,'oversized image -> 413');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
