#!/usr/bin/env node
/* One real call against the Anthropic API, reported in detail.
 *
 * The adapter has never executed. This runs it once, on a real image, and prints
 * exactly what the API accepted or rejected — enough to fix the shape without
 * anyone having to share a key.
 *
 *   ANTHROPIC_API_KEY=sk-ant-… node tools/probe-live.mjs
 *   ANTHROPIC_API_KEY=sk-ant-… node tools/probe-live.mjs path/to/letter.jpg
 *
 * The key is never printed, and no part of the image is printed. Paste the output
 * anywhere you like.
 */
import { readFileSync } from 'node:fs';
import { createAnthropicAdapter } from '../server/adapters/anthropic.js';
import { createAnalyzer } from '../server/analyze.js';

const ROOT = new URL('..', import.meta.url).pathname;
const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error('ANTHROPIC_API_KEY is not set.\n\n  ANTHROPIC_API_KEY=sk-ant-… node tools/probe-live.mjs [image.jpg]');
  process.exit(2);
}

const imgPath = process.argv[2] || ROOT + 'tests/doc1.jpg';
const bytes = readFileSync(imgPath);
const mediaType = imgPath.endsWith('.pdf') ? 'application/pdf'
                : imgPath.endsWith('.png') ? 'image/png' : 'image/jpeg';

const catalogue = JSON.parse(readFileSync(ROOT + 'contracts/catalogue.json', 'utf8'));

console.log('image     :', imgPath.replace(ROOT, ''), `(${(bytes.length / 1024).toFixed(0)}KB, ${mediaType})`);
console.log('catalogue :', Object.keys(catalogue.docs).length, 'documents,',
            Object.keys(catalogue.templates).length, 'processes');
console.log('key       : …' + key.slice(-4), '\n');

const adapter = createAnthropicAdapter({ apiKey: key });
const analyze = createAnalyzer({ adapter, catalogue });

const t0 = Date.now();
try {
  const out = await analyze({ image: bytes.toString('base64'), mediaType });

  console.log('=== IT WORKED ===\n');
  console.log('source      :', out.meta.source);
  console.log('model       :', out.meta.model, out.meta.escalated ? '(escalated)' : '');
  console.log('latency     :', out.meta.latency_ms + 'ms');
  console.log('tokens      :', out.meta.input_tokens, 'in /', out.meta.output_tokens, 'out /',
              out.meta.cache_read_tokens, 'cached');
  console.log('cost        : $' + (out.costUsd || 0).toFixed(5));
  console.log('credits     :', out.meta.credits_charged);
  console.log('signature   :', out.meta.form_signature);
  console.log('\n--- what it read ---');
  console.log(JSON.stringify(out.result, null, 2));

  console.log('\n--- sanity ---');
  const r = out.result;
  const check = (label, cond) => console.log((cond ? '  ok   ' : '  BAD  ') + label);
  check('agency is a catalogue key or null', r.agency === null || r.agency in catalogue.agencies);
  check('every doc is a catalogue key', (r.required_docs || []).every(d => d.key in catalogue.docs));
  check('every doc quotes evidence', (r.required_docs || []).every(d => (d.evidence || '').length > 0));
  check('confidence is a number 0..1', typeof r.confidence === 'number' && r.confidence >= 0 && r.confidence <= 1);
  check('form_to_fill.where is set', ['self', 'separate', 'none'].includes(r.form_to_fill?.where));
} catch (err) {
  console.log('=== IT FAILED — this is the useful part ===\n');
  console.log('after       :', (Date.now() - t0) + 'ms');
  console.log('message     :', err.message);
  if (err.upstreamStatus) console.log('http status :', err.upstreamStatus);
  /* the upstream body is what says which field is wrong */
  const body = err.upstreamBody || err.body;
  if (body) console.log('\nupstream response:\n' + body);
  else console.log('\n(no upstream body — the request may not have left the machine)');
  process.exitCode = 1;
}
