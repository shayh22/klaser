/* The preflight's two pure parts.
 *
 * The tool itself needs a key and a network, so it cannot be tested here. These two
 * pieces can, and they are the pieces that would be wrong in a way nobody notices:
 * a PDF with a broken xref would be dropped by the parser, making the "PDF path
 * works" check pass against a document that never arrived; and the advice attached
 * to each status code is read exactly once, during a failure, by someone who has no
 * way to tell that it is wrong.
 */
import { tinyPdf, diagnose } from '../tools/preflight.mjs';
import { runPreflight, PDF_WORD } from '../server/diagnose.js';
import { createApp } from '../server/index.js';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (m, c) => { c ? (pass++, console.log('PASS  ' + m)) : (fail++, console.log('FAIL  ' + m)); };

/* ---- the PDF is a real PDF ---- */
const pdf = tinyPdf();
ok('starts with the PDF header', pdf.startsWith('%PDF-'));
ok('ends with the EOF marker', pdf.trimEnd().endsWith('%%EOF'));
ok('is pure ASCII, so string length is byte length',
  Buffer.from(pdf, 'latin1').length === pdf.length && !/[^\x00-\x7F]/.test(pdf));
ok('carries the word the check looks for', pdf.includes('KLASERPDFOK'));
ok('the word is configurable', tinyPdf('HELLO').includes('(HELLO) Tj'));

/* The offsets are the part that has to be right. A PDF whose xref points at the
   wrong bytes still looks like a PDF and still fails to parse. */
const startxref = Number(pdf.match(/startxref\s+(\d+)/)[1]);
ok('startxref points at the xref table', pdf.slice(startxref, startxref + 4) === 'xref');

const entries = [...pdf.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map(m => Number(m[1]));
ok('one xref entry per object', entries.length === 5);
ok('every offset lands on its object header',
  entries.every((off, i) => pdf.slice(off).startsWith(`${i + 1} 0 obj`)));
ok('the trailer names the catalogue', /\/Root 1 0 R/.test(pdf));
ok('the declared size counts the free entry too', /\/Size 6/.test(pdf));

/* the stream length must match the stream, or the content is truncated */
const declared = Number(pdf.match(/\/Length (\d+)/)[1]);
const actual = pdf.match(/stream\n([\s\S]*?)\nendstream/)[1].length;
ok('the content stream declares its real length', declared === actual);

/* ---- the advice ---- */
const has = (d, s) => (d.why + ' ' + d.fix).toLowerCase().includes(s);

ok('a bad key says so', has(diagnose(401, ''), 'key was rejected'));
ok('no credit points at the credits page', has(diagnose(402, ''), 'openrouter.ai/credits'));

/* The one that matters most: this 404 reads like a missing model and is not. */
const routed = diagnose(404, 'No endpoints available matching your guardrail restrictions and data policy');
ok('the routing 404 is named as the routing, not a missing model',
  has(routed, 'privacy routing') && !has(routed, 'slug does not exist'));
ok('the routing 404 names the escape hatch', has(routed, 'openrouter_zdr=0'));
ok('and warns what the escape hatch costs', has(routed, "real person"));
ok('the data-policy wording is recognised too',
  has(diagnose(404, 'restricted by your data policy'), 'privacy routing'));

/* "no allowed providers" is the same failure wearing different words */
ok('the no-allowed-providers wording is routing too',
  has(diagnose(404, 'No allowed providers are available for the selected model.'), 'privacy routing'));

/* a 404 that really is a missing model must NOT be diagnosed as the routing one */
const missing = diagnose(404, '{"error":{"message":"The model `anthropic/claude-sonnet-9` does not exist"}}');
ok('a genuinely missing model is a missing slug', has(missing, 'slug does not exist'));
ok('a missing slug says a var fixes it without a deploy', has(missing, 'no deploy'));

ok('a schema rejection points at model support', has(diagnose(400, 'response_format not supported'), 'response_format'));
ok('a plain 400 defers to the upstream body', has(diagnose(400, 'bad thing'), 'which field'));
ok('rate limiting explains the free-tier caps',
  has(diagnose(429, ''), '20 requests a minute') && has(diagnose(429, ''), '50 a day'));
ok('an unknown status still returns advice', has(diagnose(503, ''), 'upstream response'));
ok('a missing body never throws', typeof diagnose(500).why === 'string');

/* ---- the checks themselves, against a gateway that answers badly ----
   The point of this endpoint is that each failure names its own fix, so what is
   asserted is that the right check fails and carries the right advice — not that
   some check somewhere went red. */
const replies = new Map();
const spy = async (url, opts) => {
  const key = String(url).includes('/key') ? 'key' : JSON.parse(opts.body).model;
  const r = replies.get(key) || replies.get('*');
  return r();
};
const okJson = obj => async () => ({ ok: true, json: async () => obj });
const good = word => okJson({ choices: [{ message: { content: JSON.stringify({ word }) } }],
                              usage: { cost: 0.0002 } });
const MODELS = { identify: 'a/one', read: 'a/two', escalate: 'a/three' };

/* everything healthy */
replies.clear();
replies.set('key', okJson({ data: { label: 'klaser', limit: 5, usage: 0.02, is_free_tier: false } }));
replies.set('a/one', good('ping'));
replies.set('a/three', good('ping'));
let pdfTurn = 0;
replies.set('a/two', async () => (++pdfTurn === 3 ? good(PDF_WORD)() : good('ping')()));
let out = await runPreflight({ apiKey: 'k', models: MODELS, fetchImpl: spy });
ok('a healthy gateway passes every check', out.ok);
ok('all six checks ran', out.checks.length === 6);
ok('the money spent is reported', out.spent_usd > 0);
ok('the routing it tested is the routing production sends',
  out.routing.zdr === true && out.routing.data_collection === 'deny' && out.routing.require_parameters === true);

/* the routing filter leaves no provider — the likeliest real failure */
replies.clear();
replies.set('key', okJson({ data: {} }));
replies.set('*', async () => ({ ok: false, status: 404,
  text: async () => 'No endpoints available matching your guardrail restrictions and data policy' }));
out = await runPreflight({ apiKey: 'k', models: MODELS, fetchImpl: spy });
ok('a routing 404 fails the run', !out.ok);
ok('and is named as the routing, not a missing model',
  out.checks.find(c => c.name === 'model:read').why.includes('privacy routing'));
ok('the fix names the variables to change',
  out.checks.find(c => c.name === 'model:read').fix.includes('OPENROUTER_ZDR=0'));

/* no credit */
replies.clear();
replies.set('key', okJson({ data: {} }));
replies.set('*', async () => ({ ok: false, status: 402, text: async () => 'insufficient credits' }));
out = await runPreflight({ apiKey: 'k', models: MODELS, fetchImpl: spy });
ok('no credit is reported as no credit',
  out.checks.find(c => c.name === 'model:identify').why.includes('out of credit'));

/* the silent one: the model answers, but never saw the document */
replies.clear();
replies.set('key', okJson({ data: {} }));
replies.set('a/one', good('ping'));
replies.set('a/three', good('ping'));
replies.set('a/two', good('ping'));          // same answer for text, image AND pdf
out = await runPreflight({ apiKey: 'k', models: MODELS, fetchImpl: spy });
const pdfCheck = out.checks.find(c => c.name === 'pdf');
ok('a PDF that never arrived fails, even though the model answered', !pdfCheck.ok);
ok('and says the document is not reaching the model', pdfCheck.why.includes('did not read the word'));
ok('with the engine to try instead', pdfCheck.fix.includes('mistral-ocr'));
ok('the run as a whole fails on it', !out.ok);

/* nothing in the result may carry key material or a letter */
replies.clear();
replies.set('key', okJson({ data: { label: 'k' } }));
replies.set('*', good('ping'));
out = await runPreflight({ apiKey: 'sk-or-v1-SECRETVALUE', models: MODELS, fetchImpl: spy });
ok('the key never appears in the result', !JSON.stringify(out).includes('SECRETVALUE'));

/* ---- and the route the phone actually opens ---- */
const catalogue = JSON.parse(readFileSync(new URL('../contracts/catalogue.json', import.meta.url).pathname, 'utf8'));
const mockApp = createApp({ catalogue, env: {} });
const r1 = await mockApp(new Request('http://x/v1/preflight'));
ok('the route refuses to pretend on a mock deployment', r1.status === 400);
ok('and says which provider it found', (await r1.json()).error.provider === 'mock');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
