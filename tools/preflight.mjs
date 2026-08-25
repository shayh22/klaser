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
 * The key is never printed beyond its last four characters.
 */
import { DEFAULT_MODELS } from '../server/adapters/openrouter.js';

const API = 'https://openrouter.ai/api/v1';

/* The smallest thing that still exercises strict structured output: one required
   string property. If a provider cannot do this it cannot do the real schema. */
const PING_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['word'],
  properties: { word: { type: 'string' } }
};

/* A 1x1 PNG and a one-page PDF, both built here rather than read from disk, so the
   check has no fixtures to go missing and can be run from anywhere. */
const PIXEL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/* A PDF whose only content is one word, so "did the document arrive" has a yes/no
   answer rather than a judgement. Written out longhand because the byte offsets in
   the xref table have to be real — a PDF with a broken xref is exactly the kind of
   input that gets silently dropped, which would make this check lie. */
export function tinyPdf(word = 'KLASERPDFOK') {
  const stream = `BT /F1 24 Tf 72 700 Td (${word}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] '
      + '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefAt = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`
       + `startxref\n${xrefAt}\n%%EOF\n`;
  return pdf;
}

/* Turning a status code into the thing to actually do about it. Kept pure and
   exported so the mapping is unit-tested rather than discovered during an outage —
   these are the failures nobody sees twice, which is precisely why the advice has
   to be right the first time. */
export function diagnose(status, body) {
  const text = String(body || '');
  const has = s => text.toLowerCase().includes(s);

  if (status === 401) return {
    why: 'The key was rejected.',
    fix: 'Check OPENROUTER_API_KEY — a stray space or a truncated paste is the usual cause.'
  };
  if (status === 402) return {
    why: 'The key is valid but the account is out of credit.',
    fix: 'Add credit at https://openrouter.ai/credits. $5 covers the whole bring-up.'
  };
  /* The one worth naming precisely. It reads like a missing model and is not. */
  if (status === 404 && (has('no endpoints') || has('data policy') || has('guardrail')
                      || has('no allowed providers'))) return {
    why: 'No provider can serve this model under the privacy routing this service sends '
       + '(zdr + data_collection: deny).',
    fix: 'This is the routing working, not a broken key. Either choose a model with a '
       + 'compliant endpoint, or — only for letters you wrote yourself — re-run with '
       + 'OPENROUTER_ZDR=0 OPENROUTER_DATA_COLLECTION=allow. Never send a real person\'s '
       + 'letter with those set.'
  };
  if (status === 404) return {
    why: 'The model slug does not exist.',
    fix: 'Slugs get renamed. Find the current one at https://openrouter.ai/models and set '
       + 'the matching OPENROUTER_MODEL_* variable — no deploy needed.'
  };
  if (status === 400 && has('response_format')) return {
    why: 'The model rejected the structured-output request.',
    fix: 'Choose a model whose page lists response_format under supported parameters.'
  };
  if (status === 429) return {
    why: 'Rate limited.',
    fix: 'Free models allow 20 requests a minute, and 50 a day until $10 of credit has '
       + 'been bought once. Wait a minute, or use a paid model.'
  };
  if (status === 400) return { why: 'The request was rejected.', fix: 'The upstream response below says which field.' };
  return { why: `HTTP ${status}.`, fix: 'The upstream response below is the useful part.' };
}

/* Everything below runs the checks. Wrapped so the two pure helpers above can be
   imported and tested without a key, a network, or a process exit. */
async function main() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    console.error('OPENROUTER_API_KEY is not set.\n\n  OPENROUTER_API_KEY=sk-or-… node tools/preflight.mjs');
    process.exit(2);
  }

  const zdr = String(process.env.OPENROUTER_ZDR ?? '1') !== '0';
  const dataCollection = String(process.env.OPENROUTER_DATA_COLLECTION || 'deny');
  const MODELS = {
    identify: process.env.OPENROUTER_MODEL_IDENTIFY || DEFAULT_MODELS.identify,
    read:     process.env.OPENROUTER_MODEL_READ     || DEFAULT_MODELS.read,
    escalate: process.env.OPENROUTER_MODEL_ESCALATE || DEFAULT_MODELS.escalate
  };

  console.log('key      : …' + key.slice(-4));
  console.log('routing  : zdr=' + zdr + '  data_collection=' + dataCollection
    + (zdr && dataCollection === 'deny' ? '' : '   *** RELAXED — do not send a real letter ***'));
  console.log('');

  let failures = 0;
  let spent = 0;

  async function ask(model, parts, label) {
    const res = await fetch(API + '/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + key,
        'http-referer': 'https://github.com/shayh22/klaser',
        'x-title': 'Klaser preflight'
      },
      body: JSON.stringify({
        model,
        max_tokens: 100,
        messages: [{ role: 'user', content: parts }],
        response_format: { type: 'json_schema', json_schema: { name: 'ping', strict: true, schema: PING_SCHEMA } },
        /* Identical to what the service sends. A preflight that relaxes the routing
           would pass while production fails, which is worse than no preflight. */
        provider: { require_parameters: true, data_collection: dataCollection, zdr },
        usage: { include: true },
        ...(parts.some(p => p.type === 'file') ? { plugins: [{ id: 'file-parser', pdf: { engine: process.env.OPENROUTER_PDF_ENGINE || 'native' } }] } : {})
      })
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const d = diagnose(res.status, body);
      console.log(`  FAIL  ${label}`);
      console.log(`        ${d.why}`);
      console.log(`        → ${d.fix}`);
      if (body) console.log('        upstream: ' + body.slice(0, 300).replace(/\s+/g, ' '));
      failures++;
      return null;
    }

    const data = await res.json();
    if (data.error) {
      const d = diagnose(data.error.code || 502, JSON.stringify(data.error));
      console.log(`  FAIL  ${label}`);
      console.log(`        ${d.why}`);
      console.log(`        → ${d.fix}`);
      failures++;
      return null;
    }

    spent += (data.usage && data.usage.cost) || 0;
    const content = data.choices?.[0]?.message?.content;
    let parsed = null;
    try { parsed = JSON.parse(String(content).replace(/^```(?:json)?|```$/g, '').trim()); } catch {}
    if (!parsed || typeof parsed.word !== 'string') {
      console.log(`  FAIL  ${label}`);
      console.log('        The model answered, but not in the schema it was given.');
      console.log('        → Structured output is being asked for and not enforced. Change model:');
      console.log('          the catalogue check will drop most of its answer.');
      console.log('        got: ' + String(content).slice(0, 200));
      failures++;
      return null;
    }
    console.log(`  ok    ${label}  → "${parsed.word}"`);
    return parsed;
  }

  const say = s => console.log('\n' + s);

  /* ---- 1. the key itself ---- */
  say('1. The key');
  try {
    const r = await fetch(API + '/key', { headers: { authorization: 'Bearer ' + key } });
    if (r.ok) {
      const d = (await r.json()).data || {};
      console.log(`  ok    valid${d.label ? ' — ' + d.label : ''}`);
      if (d.limit !== null && d.limit !== undefined)
        console.log(`        limit $${d.limit}, used $${(d.usage || 0).toFixed(4)}`);
      else console.log(`        no spend limit set on this key, used $${(d.usage || 0).toFixed(4)}`);
      if (d.is_free_tier) console.log('        free tier — 50 requests a day until $10 of credit is bought once');
    } else {
      const body = await r.text().catch(() => '');
      const dg = diagnose(r.status, body);
      console.log('  FAIL  ' + dg.why + '\n        → ' + dg.fix);
      if (body) console.log('        upstream: ' + body.slice(0, 300).replace(/\s+/g, ' '));
      failures++;
    }
  } catch (e) {
    console.log('  FAIL  could not reach OpenRouter: ' + e.message);
    failures++;
  }

  /* ---- 2 & 3. each slug, under the real routing ---- */
  say('2. Each model, under the privacy routing this service sends');
  const TEXT = [{ type: 'text', text: 'Reply with the JSON object {"word":"ping"} and nothing else.' }];
  for (const [stage, model] of Object.entries(MODELS)) {
    await ask(model, TEXT, `${stage.padEnd(8)} ${model}`);
  }

  /* ---- 4. vision ---- */
  say('3. The read model accepts an image');
  await ask(MODELS.read, [
    { type: 'image_url', image_url: { url: 'data:image/png;base64,' + PIXEL_PNG } },
    { type: 'text', text: 'An image is attached. Reply with the JSON object {"word":"sawit"} and nothing else.' }
  ], 'image_url part');

  /* ---- 5. the PDF path, which fails without erroring ---- */
  say('4. The read model accepts a PDF (this one fails silently in production)');
  const pdfB64 = Buffer.from(tinyPdf(), 'latin1').toString('base64');
  const got = await ask(MODELS.read, [
    { type: 'file', file: { filename: 'letter.pdf', file_data: 'data:application/pdf;base64,' + pdfB64 } },
    { type: 'text', text: 'A PDF is attached containing exactly one word. Reply with the JSON object {"word":"<that word>"}.' }
  ], 'file part + file-parser plugin');
  if (got && got.word !== 'KLASERPDFOK') {
    console.log('  WARN  the model answered but did not read the word in the PDF.');
    console.log('        → The document is not reaching it. Try OPENROUTER_PDF_ENGINE=mistral-ocr.');
    console.log(`        expected KLASERPDFOK, got "${got.word}"`);
    failures++;
  }

  /* ---- verdict ---- */
  console.log('\n' + '-'.repeat(60));
  console.log(`spent: $${spent.toFixed(5)}`);
  if (failures) {
    console.log(`${failures} check(s) failed — each one above says what to change.`);
    process.exit(1);
  }
  console.log('All checks passed. Now run the real thing:');
  console.log('  OPENROUTER_API_KEY=… node tools/probe-live.mjs [letter.jpg]');
}

if (process.argv[1] && process.argv[1].endsWith('preflight.mjs')) await main();
