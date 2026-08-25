/* OpenRouter adapter.
 *
 * Same three calls as the Anthropic adapter — identify, read, escalate — against
 * OpenRouter's OpenAI-compatible endpoint. Raw HTTP for the same reason: this runs
 * on Workers, and the surface used here is one endpoint wide.
 *
 * Three things differ from talking to Anthropic directly, and each one is a shape
 * mistake waiting to happen:
 *
 *   1. Images are `image_url` parts holding a data: URL, not base64 `source` blocks.
 *   2. A PDF is a `file` part — and it needs the file-parser plugin named in the
 *      request, or the document is silently dropped and the model reads a blank page.
 *   3. Structured output is `response_format.json_schema`, which is strict-mode
 *      OpenAI JSON Schema: every property must be required, and the vocabulary is
 *      narrower than the schema we build for Anthropic. normaliseSchema() does that
 *      translation rather than us keeping two schemas that would drift.
 *
 * The catalogue still goes in its own system part carrying cache_control, which is
 * how OpenRouter passes an Anthropic cache breakpoint through.
 */

const API = 'https://openrouter.ai/api/v1/chat/completions';

/* Which model does what. The decision itself is in docs/MODEL-OPTIONS.md — cheap
   model identifies, mid model reads, strong model escalates. These are only the
   slugs, and they are env-overridable because OpenRouter's names move faster than
   this file does: a renamed slug should be a variable to change in the dashboard,
   not a deploy. */
export const DEFAULT_MODELS = {
  identify: 'anthropic/claude-haiku-4.5',
  read:     'anthropic/claude-sonnet-4.5',
  escalate: 'anthropic/claude-opus-4.5'
};

/* $/1M tokens, used only for the spend cap and only as a fallback: OpenRouter
   reports what it actually charged in usage.cost, which is exact and survives a
   model swap. This table is what the cap falls back to if it does not. */
const PRICES = {
  'anthropic/claude-haiku-4.5':  { in: 1, out: 5 },
  'anthropic/claude-sonnet-4.5': { in: 3, out: 15 },
  'anthropic/claude-opus-4.5':   { in: 5, out: 25 }
};
const FALLBACK_PRICE = { in: 3, out: 15 };

export function costOf(model, usage) {
  if (typeof usage.cost === 'number') return usage.cost;
  const p = PRICES[model] || FALLBACK_PRICE;
  const cached = usage.cache_read_input_tokens || 0;
  const fresh = usage.input_tokens || 0;
  return ((fresh + cached * 0.1) * p.in + (usage.output_tokens || 0) * p.out) / 1e6;
}

/* OpenAI strict mode is stricter than the schema we hand Anthropic, in two ways
   that reject the request outright rather than degrading: every key in properties
   must also appear in required, and the keyword vocabulary is narrower. So the one
   schema built from the catalogue is translated here instead of being maintained
   twice — the catalogue enums, which are the part that matters, come through
   untouched.
   The constraints dropped here (maxLength, maxItems, ranges) are re-applied after
   the answer comes back, in validate.js. */
const DROPPED = new Set(['maxLength', 'minLength', 'maxItems', 'minItems',
                         'minimum', 'maximum', 'format', 'pattern', 'default']);

export function normaliseSchema(schema) {
  if (Array.isArray(schema)) return schema.map(normaliseSchema);
  if (!schema || typeof schema !== 'object') return schema;

  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (DROPPED.has(k)) continue;
    out[k] = (k === 'properties')
      ? Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, normaliseSchema(pv)]))
      : normaliseSchema(v);
  }

  if (out.type === 'object' && out.properties) {
    out.required = Object.keys(out.properties);
    out.additionalProperties = false;
  }
  return out;
}

/* A model that answers in a ```json fence despite being asked for a schema is not
   a hypothetical — it is what a weaker provider on the same slug does. Cheaper to
   strip it than to fail a read the user paid for. */
function parseContent(text) {
  const trimmed = String(text || '').trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return JSON.parse(fenced ? fenced[1] : trimmed);
}

export function createOpenRouterAdapter({
  apiKey,
  fetchImpl = fetch,
  models = {},
  referer = 'https://github.com/shayh22/klaser',
  title = 'Klaser',
  pdfEngine = 'native',
  zdr = true,
  dataCollection = 'deny'
} = {}) {
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');
  const MODELS = { ...DEFAULT_MODELS, ...models };

  async function call({ model, system, cachedPrefix, image, mediaType, instruction, schema, maxTokens = 2000 }) {
    const systemParts = [{ type: 'text', text: system }];
    if (cachedPrefix) {
      /* Cache the catalogue, not the instructions — the catalogue is the identical
         part of every request, and it is what clears the minimum cacheable size. */
      systemParts.push({ type: 'text', text: cachedPrefix, cache_control: { type: 'ephemeral' } });
    }

    const content = [];
    const isPdf = mediaType === 'application/pdf';
    if (image) {
      const mt = mediaType || 'image/jpeg';
      content.push(isPdf
        /* People forward the letter the agency emailed them at least as often as
           they photograph paper, so the PDF path is not an edge case. A PDF sent
           as an image_url is rejected. */
        ? { type: 'file', file: { filename: 'letter.pdf', file_data: `data:${mt};base64,${image}` } }
        : { type: 'image_url', image_url: { url: `data:${mt};base64,${image}` } });
    }
    content.push({ type: 'text', text: instruction });

    const body = {
      model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemParts },
        { role: 'user', content }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'klaser_analysis', strict: true, schema: normaliseSchema(schema) }
      },
      /* require_parameters keeps the request away from any provider that would
         quietly ignore response_format and hand back prose. The other two are the
         privacy position in docs/privacy-decisions.md expressed as routing: a
         letter must not reach a provider that retains it or trains on it. If this
         ever leaves no route at all, the upstream body says so in as many words. */
      provider: { require_parameters: true, data_collection: dataCollection, zdr },
      /* Ask for what it actually cost. The daily cap then counts real money rather
         than a price table that goes stale the day a model is repriced. */
      usage: { include: true }
    };
    if (isPdf) body.plugins = [{ id: 'file-parser', pdf: { engine: pdfEngine } }];

    const res = await fetchImpl(API, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
        /* Attribution headers. Neither is required; both are what makes a rejection
           traceable to this app rather than to an anonymous key. */
        'http-referer': referer,
        'x-title': title
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      const err = new Error(`openrouter ${res.status}`);
      err.status = res.status;
      err.body = detail.slice(0, 500);
      throw err;
    }

    const data = await res.json();

    /* OpenRouter reports some upstream failures as a 200 with an error object.
       Treating that as a success means parsing undefined and reporting
       "unparseable model output" for what was actually a rate limit. */
    if (data.error) {
      const err = new Error(`openrouter upstream: ${data.error.message || 'error'}`);
      err.status = data.error.code || 502;
      err.body = JSON.stringify(data.error).slice(0, 500);
      throw err;
    }

    const message = (data.choices || [])[0]?.message;
    if (message && message.refusal) {
      const err = new Error('model refused the request');
      err.status = 422;
      err.body = String(message.refusal).slice(0, 500);
      throw err;
    }

    let parsed;
    try { parsed = parseContent(message && message.content); }
    catch {
      const e = new Error('unparseable model output');
      e.status = 502;
      e.body = String((message && message.content) || '').slice(0, 500);
      throw e;
    }

    const u = data.usage || {};
    const cached = (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || 0;
    return {
      parsed,
      /* Renamed to the names analyze.js already counts in. prompt_tokens includes
         the cached tokens here and excludes them in Anthropic's own reporting, so
         subtracting is what keeps one number meaning one thing. */
      usage: {
        input_tokens: Math.max(0, (u.prompt_tokens || 0) - cached),
        output_tokens: u.completion_tokens || 0,
        cache_read_input_tokens: cached,
        cost: typeof u.cost === 'number' ? u.cost : undefined
      },
      model: data.model || model
    };
  }

  return {
    name: 'openrouter',
    identify: opts => call({ model: MODELS.identify, maxTokens: 600, ...opts }),
    read:     opts => call({ model: MODELS.read,     maxTokens: 3000, ...opts }),
    /* The strong model reasons before answering and that shares the token budget,
       so the escalation needs headroom the other two do not. */
    escalate: opts => call({ model: MODELS.escalate, maxTokens: 8000, ...opts }),
    models: MODELS,
    costOf
  };
}
