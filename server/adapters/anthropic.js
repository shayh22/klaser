/* Anthropic adapter.
 *
 * Raw HTTP rather than the SDK: this runs on Workers, where a dependency-free fetch
 * is one less thing in the bundle, and the surface used here is two endpoints wide.
 *
 * The catalogue block is the first content block and carries cache_control, so the
 * part that never changes is the part that gets cached.
 */

const API = 'https://api.anthropic.com/v1/messages';
const VERSION = '2023-06-01';

/* $/1M tokens. Used for the spend cap, not for billing anyone. */
const PRICES = {
  'claude-haiku-4-5': { in: 1, out: 5 },
  'claude-sonnet-5':  { in: 3, out: 15 },
  'claude-opus-5':    { in: 5, out: 25 }
};

export function costOf(model, usage) {
  const p = PRICES[model] || PRICES['claude-sonnet-5'];
  const cached = usage.cache_read_input_tokens || 0;
  const fresh = (usage.input_tokens || 0);
  return ((fresh + cached * 0.1) * p.in + (usage.output_tokens || 0) * p.out) / 1e6;
}

export function createAnthropicAdapter({ apiKey, fetchImpl = fetch }) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');

  async function call({ model, system, cachedPrefix, image, mediaType, instruction, schema, maxTokens = 2000 }) {
    const systemBlocks = [{ type: 'text', text: system }];
    if (cachedPrefix) {
      /* Cache the catalogue, not the instructions — the catalogue is the identical
         part, and it is what clears the 1024-token minimum. */
      systemBlocks.push({ type: 'text', text: cachedPrefix, cache_control: { type: 'ephemeral' } });
    }

    const content = [];
    if (image) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: image }
      });
    }
    content.push({ type: 'text', text: instruction });

    const res = await fetchImpl(API, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': VERSION
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: systemBlocks,
        messages: [{ role: 'user', content }],
        output_config: { format: { type: 'json_schema', schema } }
      })
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`anthropic ${res.status}`);
      err.status = res.status;
      err.body = body.slice(0, 500);
      throw err;
    }

    const data = await res.json();
    /* output_config.format guarantees the first text block is valid JSON. Parsing
       defensively anyway: a malformed body should surface as upstream_error, not as
       an exception thrown mid-request. */
    const text = (data.content || []).find(b => b.type === 'text')?.text;
    let parsed;
    try { parsed = JSON.parse(text); }
    catch { const e = new Error('unparseable model output'); e.status = 502; throw e; }

    return { parsed, usage: data.usage || {}, model: data.model || model };
  }

  return {
    name: 'anthropic',
    identify: opts => call({ model: 'claude-haiku-4-5', maxTokens: 400, ...opts }),
    read:     opts => call({ model: 'claude-sonnet-5',  maxTokens: 2000, ...opts }),
    escalate: opts => call({ model: 'claude-opus-5',    maxTokens: 2000, ...opts }),
    costOf
  };
}
