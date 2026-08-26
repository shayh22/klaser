#!/usr/bin/env node
/* Does this key actually work, before a real letter is spent on finding out.
 *
 * tools/probe-live.mjs runs the whole pipeline on a real letter. That is the right
 * test, and it is the wrong first test: when it fails you are looking at one error
 * from a two-call pipeline and guessing which of five things caused it. This asks
 * the five questions separately, on inputs a few hundred tokens long, so each answer
 * is unambiguous and the whole run costs a fraction of a cent:
 *
 *   1. Is the key valid, and does it have credit?
 *   2. Does each configured model slug still exist?
 *   3. Does the privacy routing leave any provider able to serve it?   <- the likely one
 *   4. Does the read model accept an image?
 *   5. Does the read model accept a PDF?                               <- the silent one
 *
 * Questions 3 and 5 are the reason this file exists. A too-narrow routing policy
 * returns a 404 that reads like a missing model, and a wrong PDF shape returns a
 * confident answer about a blank page. Neither is obvious from the pipeline's error.
 *
 *   OPENROUTER_API_KEY=sk-or-… node tools/preflight.mjs
 *
 * The checks themselves live in server/diagnose.js, because the people who most
 * need them are the ones who cannot run a terminal — the deploy-from-a-phone path
 * reaches the same code through GET /v1/preflight. One implementation of what
 * "working" means, two ways to read it.
 *
 * The key is never printed beyond its last four characters.
 */
import { DEFAULT_MODELS } from '../server/adapters/openrouter.js';
import { runPreflight, PDF_WORD, tinyPdf, diagnose } from '../server/diagnose.js';

/* re-exported so tests/preflighttest.mjs keeps asserting the pure parts here */
export { tinyPdf, diagnose };

async function main() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    console.error('OPENROUTER_API_KEY is not set.\n\n  OPENROUTER_API_KEY=sk-or-… node tools/preflight.mjs');
    process.exit(2);
  }

  const zdr = String(process.env.OPENROUTER_ZDR ?? '1') !== '0';
  const dataCollection = String(process.env.OPENROUTER_DATA_COLLECTION || 'deny');
  const models = {
    identify: process.env.OPENROUTER_MODEL_IDENTIFY || DEFAULT_MODELS.identify,
    read:     process.env.OPENROUTER_MODEL_READ     || DEFAULT_MODELS.read,
    escalate: process.env.OPENROUTER_MODEL_ESCALATE || DEFAULT_MODELS.escalate
  };

  console.log('key      : …' + key.slice(-4));
  console.log('routing  : zdr=' + zdr + '  data_collection=' + dataCollection
    + (zdr && dataCollection === 'deny' ? '' : '   *** RELAXED — do not send a real letter ***'));
  console.log('models   : ' + Object.entries(models).map(([k, v]) => `${k}=${v}`).join('  '));
  console.log('');

  const out = await runPreflight({
    apiKey: key, models, zdr, dataCollection,
    pdfEngine: process.env.OPENROUTER_PDF_ENGINE || 'native'
  });

  for (const c of out.checks) {
    if (c.ok) {
      const d = c.detail || {};
      const note = d.word ? ` → "${d.word}"`
                 : d.label !== undefined ? ` — ${d.label || 'valid'}${d.free_tier ? ', free tier' : ''}` : '';
      console.log(`  ok    ${c.name}${c.model ? '  ' + c.model : ''}${note}`);
    } else {
      console.log(`  FAIL  ${c.name}${c.model ? '  ' + c.model : ''}`);
      console.log(`        ${c.why}`);
      console.log(`        → ${c.fix}`);
      if (c.upstream) console.log('        upstream: ' + String(c.upstream).replace(/\s+/g, ' '));
    }
  }

  console.log('\n' + '-'.repeat(60));
  console.log(`spent: $${(out.spent_usd || 0).toFixed(5)}`);
  if (!out.ok) {
    console.log('Some checks failed — each one above says what to change.');
    process.exit(1);
  }
  console.log(`PDF path verified by reading "${PDF_WORD}" back out of a generated file.`);
  console.log('All checks passed. Now run the real thing:');
  console.log('  OPENROUTER_API_KEY=… node tools/probe-live.mjs [letter.jpg]');
}

if (process.argv[1] && process.argv[1].endsWith('preflight.mjs')) await main();
