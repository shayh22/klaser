/* The five questions, asked one at a time.
 *
 * `/v1/analyze` failing tells you almost nothing: it is a two-call pipeline behind a
 * gateway, and the browser is shown a Hebrew sentence rather than the upstream's
 * words, deliberately. So when a deployment says "הניתוח לא זמין כרגע" the owner is
 * left guessing between a dead key, no credit, a renamed model slug, a privacy
 * filter that leaves no provider, a model that will not do structured output, and a
 * PDF shape the parser drops.
 *
 * Each of those has a different fix, so each gets its own question here, asked on an
 * input a few hundred tokens long. The whole run costs about a tenth of a cent.
 *
 * This lives in server/ rather than tools/ because the people who most need it are
 * the ones who cannot run a terminal — the deploy-from-a-phone path. tools/
 * preflight.mjs prints the same results; both call runPreflight so there is one
 * implementation of what "working" means.
 */

const API = 'https://openrouter.ai/api/v1';

/* The smallest thing that still exercises strict structured output. A provider that
   cannot manage this cannot manage the real schema either. */
const PING_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['word'],
  properties: { word: { type: 'string' } }
};

const PIXEL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export const PDF_WORD = 'KLASERPDFOK';

/* A PDF whose only content is one word, so "did the document arrive" has a yes/no
   answer rather than a judgement. Written longhand because the byte offsets in the
   xref table have to be real — a PDF with a broken xref is exactly the kind of input
   that gets silently dropped, which would make this check lie about the one thing it
   exists to test. */
export function tinyPdf(word = PDF_WORD) {
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

/* Turning a status into the thing to actually do about it. Pure and exported so the
   mapping is unit-tested rather than discovered during an outage — this advice is
   read exactly once, during a failure, by someone with no way to tell it is wrong. */
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
  /* The one worth naming precisely: it reads like a missing model and is not. */
  if (status === 404 && (has('no endpoints') || has('data policy') || has('guardrail')
                      || has('no allowed providers'))) return {
    why: 'No provider can serve this model under the privacy routing this service sends '
       + '(zdr + data_collection: deny).',
    fix: 'This is the routing working, not a broken key. Either choose a model with a '
       + 'compliant endpoint, or — only for letters you wrote yourself — set '
       + 'OPENROUTER_ZDR=0 and OPENROUTER_DATA_COLLECTION=allow. Never send a real '
       + "person's letter with those set."
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
  if (status === 400) return {
    why: 'The request was rejected.',
    fix: 'The upstream response says which field.'
  };
  return { why: `HTTP ${status}.`, fix: 'The upstream response is the useful part.' };
}

/* base64 for a latin1 string, in a way that works both on Workers and on Node. */
function b64(str) {
  if (typeof btoa === 'function') return btoa(str);
  return Buffer.from(str, 'latin1').toString('base64');
}

export async function runPreflight({
  apiKey,
  models,
  zdr = true,
  dataCollection = 'deny',
  pdfEngine = 'native',
  fetchImpl = fetch
} = {}) {
  const checks = [];
  let spentUsd = 0;

  const record = (name, ok, extra = {}) => { checks.push({ name, ok, ...extra }); return ok; };

  /* ---- 1. the key itself ---- */
  try {
    const r = await fetchImpl(API + '/key', { headers: { authorization: 'Bearer ' + apiKey } });
    if (r.ok) {
      const d = (await r.json()).data || {};
      record('key', true, {
        detail: {
          label: d.label || null,
          limit: d.limit ?? null,
          used: typeof d.usage === 'number' ? d.usage : null,
          free_tier: !!d.is_free_tier
        }
      });
    } else {
      const body = await r.text().catch(() => '');
      record('key', false, { status: r.status, ...diagnose(r.status, body), upstream: body.slice(0, 300) });
    }
  } catch (e) {
    record('key', false, { why: 'Could not reach OpenRouter at all.', fix: String(e && e.message).slice(0, 200) });
  }

  async function ask(name, model, parts) {
    let res;
    try {
      res = await fetchImpl(API + '/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + apiKey,
          'http-referer': 'https://github.com/shayh22/klaser',
          'x-title': 'Klaser preflight'
        },
        body: JSON.stringify({
          model,
          max_tokens: 100,
          messages: [{ role: 'user', content: parts }],
          response_format: { type: 'json_schema', json_schema: { name: 'ping', strict: true, schema: PING_SCHEMA } },
          /* Identical to what the service sends. A preflight that relaxed the routing
             would pass while production failed, which is worse than no preflight. */
          provider: { require_parameters: true, data_collection: dataCollection, zdr },
          usage: { include: true },
          ...(parts.some(p => p.type === 'file')
            ? { plugins: [{ id: 'file-parser', pdf: { engine: pdfEngine } }] } : {})
        })
      });
    } catch (e) {
      return record(name, false, { model, why: 'The request never completed.', fix: String(e && e.message).slice(0, 200) });
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return record(name, false, { model, status: res.status, ...diagnose(res.status, body), upstream: body.slice(0, 300) });
    }

    const data = await res.json().catch(() => ({}));
    if (data.error) {
      const d = diagnose(data.error.code || 502, JSON.stringify(data.error));
      return record(name, false, { model, ...d, upstream: String(data.error.message || '').slice(0, 300) });
    }

    spentUsd += (data.usage && typeof data.usage.cost === 'number') ? data.usage.cost : 0;

    const content = data.choices?.[0]?.message?.content;
    let parsed = null;
    try { parsed = JSON.parse(String(content).replace(/^```(?:json)?|```$/g, '').trim()); } catch {}
    if (!parsed || typeof parsed.word !== 'string') {
      return record(name, false, {
        model,
        why: 'The model answered, but not in the schema it was given.',
        fix: 'Structured output is being asked for and not enforced. Change model — the '
           + 'catalogue check would drop most of its answer.',
        upstream: String(content || '').slice(0, 200)
      });
    }
    return record(name, true, { model, detail: { word: parsed.word } });
  }

  /* ---- 2 & 3. each slug, under the real routing ---- */
  const TEXT = [{ type: 'text', text: 'Reply with the JSON object {"word":"ping"} and nothing else.' }];
  for (const stage of ['identify', 'read', 'escalate']) {
    await ask('model:' + stage, models[stage], TEXT);
  }

  /* ---- 4. vision ---- */
  await ask('image', models.read, [
    { type: 'image_url', image_url: { url: 'data:image/png;base64,' + PIXEL_PNG } },
    { type: 'text', text: 'An image is attached. Reply with the JSON object {"word":"sawit"} and nothing else.' }
  ]);

  /* ---- 5. the PDF path, which fails without erroring ---- */
  const pdfOk = await ask('pdf', models.read, [
    { type: 'file', file: { filename: 'letter.pdf', file_data: 'data:application/pdf;base64,' + b64(tinyPdf()) } },
    { type: 'text', text: 'A PDF is attached containing exactly one word. Reply with the JSON object {"word":"<that word>"}.' }
  ]);
  const pdfCheck = checks[checks.length - 1];
  if (pdfOk && pdfCheck.detail.word !== PDF_WORD) {
    pdfCheck.ok = false;
    pdfCheck.why = 'The model answered but did not read the word in the PDF.';
    pdfCheck.fix = 'The document is not reaching it. Try OPENROUTER_PDF_ENGINE=mistral-ocr.';
  }

  return {
    ok: checks.every(c => c.ok),
    spent_usd: Number(spentUsd.toFixed(5)),
    routing: { zdr, data_collection: dataCollection, require_parameters: true },
    models,
    checks
  };
}
