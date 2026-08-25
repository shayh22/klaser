#!/usr/bin/env node
/* One real call against whichever provider is configured, reported in detail.
 *
 * Every assertion in the test suite is about a request. None of them is about a
 * response, because no adapter has ever been given one by the real thing. This runs
 * the whole pipeline once, on a real image, and prints exactly what was accepted or
 * rejected — enough to fix the shape without anyone having to share a key.
 *
 *   OPENROUTER_API_KEY=sk-or-… node tools/probe-live.mjs
 *   OPENROUTER_API_KEY=sk-or-… node tools/probe-live.mjs path/to/letter.pdf
 *   ANTHROPIC_API_KEY=sk-ant-… node tools/probe-live.mjs
 *
 * It selects the provider exactly as the Worker does, so what this exercises is the
 * deployed path and not a second one that happens to look like it.
 *
 * The key is never printed, and no part of the image is printed. Paste the output
 * anywhere you like.
 */
import { readFileSync } from 'node:fs';
import { chooseAdapter } from '../server/index.js';
import { createAnalyzer } from '../server/analyze.js';

const ROOT = new URL('..', import.meta.url).pathname;
const key = process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error('No API key set.\n\n  OPENROUTER_API_KEY=sk-or-… node tools/probe-live.mjs [letter.jpg]\n'
              + '  ANTHROPIC_API_KEY=sk-ant-… node tools/probe-live.mjs [letter.jpg]');
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
const adapter = chooseAdapter(process.env);
/* The mock needs no key, so reaching it here means the key is set but something
   about the selection is not what the caller assumed. Better to stop than to print
   a fixture under the heading "IT WORKED". */
if (adapter.name === 'mock') {
  console.error('A key is set but the mock was selected — check AI_PROVIDER.');
  process.exit(2);
}

console.log('key       : …' + key.slice(-4));
console.log('provider  :', adapter.name);
if (adapter.models) console.log('models    :', Object.entries(adapter.models).map(([k, v]) => `${k}=${v}`).join('  '));
console.log('');

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
  /* Anything but 0 means the model answered outside the catalogue and the check
     caught it. Worth seeing on the very first real call: it is the difference
     between the schema being enforced upstream and only being asked for. */
  console.log('dropped     :', out.meta.dropped, out.meta.dropped ? '  <- the catalogue check refused part of the answer' : '');
  console.log('signature   :', out.meta.form_signature);
  console.log('\n--- what it read ---');
  console.log(JSON.stringify(out.result, null, 2));

  console.log('\n--- sanity ---');
  const r = out.result;
  const check = (label, cond) => console.log((cond ? '  ok   ' : '  BAD  ') + label);
  check('agency is a catalogue key or null', r.agency === null || r.agency in catalogue.agencies);
  check('the agency has a name either way', !!r.agency_he || r.agency === null);
  /* A key is optional now — the catalogue translates, it does not permit. What every
     document must have is a name to show and a quote to justify it. */
  check('every doc names a catalogue key or nothing',
    (r.required_docs || []).every(d => d.key === null || d.key in catalogue.docs));
  check('every doc has a hebrew name', (r.required_docs || []).every(d => (d.he || '').length > 0));
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
