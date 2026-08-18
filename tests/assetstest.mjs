/* Serving the app from the Worker, and the endpoint injection that switches the
 * feature on.
 *
 * This is the load-bearing part of the deployment and it had no test. If injection
 * silently fails, the deployed page looks completely normal with the feature off —
 * the hardest possible symptom to diagnose, especially from a phone.
 */
import { injectConfig, isHtmlPath, serveAsset } from '../server/assets.js';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
let pass = 0, fail = 0;
const ok = (m, c) => { c ? (pass++, console.log('PASS  ' + m)) : (fail++, console.log('FAIL  ' + m)); };

/* ---- injectConfig ---- */
const page = '<html><body><h1>hi</h1><script>const a=1;</script></body></html>';

const same = injectConfig(page);
ok('injects a script tag', same.includes('window.KLASER_AI_ENDPOINT'));
ok('same-origin injects an expression, not a string', same.includes('= location.origin'));
ok('injects before the app script', same.indexOf('KLASER_AI_ENDPOINT') < same.indexOf('const a=1'));
ok('original content survives', same.includes('<h1>hi</h1>') && same.includes('const a=1'));

const explicit = injectConfig(page, 'https://api.example.com');
ok('an explicit endpoint is quoted as a string', explicit.includes('= "https://api.example.com"'));

ok('injecting twice changes nothing', injectConfig(same) === same);
ok('a page with no script tag is left alone', injectConfig('<html></html>') === '<html></html>');

/* ---- path classification ---- */
ok('root is html', isHtmlPath('/'));
ok('index.html is html', isHtmlPath('/index.html'));
ok('an image is not html', !isHtmlPath('/docs/og-image.jpg'));
ok('a video is not html', !isHtmlPath('/docs/clip.mp4'));

/* ---- serveAsset ---- */
const fake = body => ({ async fetch() { return new Response(body, { headers: { 'content-type': 'text/html' } }); } });
const r1 = await serveAsset(new Request('http://x/'), { assets: fake(page) });
ok('html is rewritten on the way out', (await r1.text()).includes('KLASER_AI_ENDPOINT'));

const img = { async fetch() { return new Response('binary', { headers: { 'content-type': 'image/jpeg' } }); } };
const r2 = await serveAsset(new Request('http://x/docs/a.jpg'), { assets: img });
ok('non-html passes through untouched', (await r2.text()) === 'binary');

const missing = { async fetch() { return new Response('nope', { status: 404 }); } };
const r3 = await serveAsset(new Request('http://x/nothing'), { assets: missing });
ok('a 404 is returned as-is', r3.status === 404);

ok('no assets binding means no asset', (await serveAsset(new Request('http://x/'), {})) === null);

/* ---- end to end: the real page, through the real server ---- */
const srv = spawn('node', [ROOT + 'server/dev.js'], { env: { ...process.env, PORT: '8791' }, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
try {
  const res = await fetch('http://127.0.0.1:8791/');
  const html = await res.text();
  ok('the Worker serves the app at /', res.ok && html.includes('קלסר'));
  ok('the served page carries the endpoint', html.includes('window.KLASER_AI_ENDPOINT'));
  ok('the served page resolves the endpoint to its own origin', html.includes('location.origin'));

  const raw = readFileSync(ROOT + 'index.html', 'utf8');
  ok('the file on disk carries no endpoint — only the served copy does',
     !raw.includes('window.KLASER_AI_ENDPOINT ='));

  const h = await (await fetch('http://127.0.0.1:8791/v1/health')).json();
  ok('the API is on the same origin as the app', h.status === 'ok');
  ok('without a key the provider is the mock', h.provider === 'mock');
} finally { srv.kill(); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
