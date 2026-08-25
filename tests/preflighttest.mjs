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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
