/* Klaser cloud service — Worker entry point.
 *
 * Three routes. No route stores a document, and none can: nothing here writes to a
 * bucket, and the only table is a credit counter.
 */

import { ApiError, errorResponse, json } from './errors.js';
import { MemoryStore, D1Store } from './store.js';
import { createAnalyzer } from './analyze.js';
import { createAnthropicAdapter } from './adapters/anthropic.js';
import { createMockAdapter } from './adapters/mock.js';
import { serveAsset } from './assets.js';

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MEDIA_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const DEFAULT_DAILY_CAP_USD = 25;

export function createApp({ catalogue, env = {}, store, adapter, lookup, assets }) {
  assets = assets || env.ASSETS;
  const dailyCap = Number(env.DAILY_SPEND_CAP_USD || DEFAULT_DAILY_CAP_USD);
  const origins = String(env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());

  store = store || (env.DB
    ? new D1Store(env.DB, { freeCredits: Number(env.FREE_CREDITS || 10) })
    : new MemoryStore({ freeCredits: Number(env.FREE_CREDITS || 10) }));

  adapter = adapter || (env.ANTHROPIC_API_KEY
    ? createAnthropicAdapter({ apiKey: env.ANTHROPIC_API_KEY })
    : createMockAdapter());

  const analyze = createAnalyzer({ adapter, catalogue, lookup });

  function cors(origin) {
    const allow = origins.includes('*') ? '*' : (origins.includes(origin) ? origin : origins[0] || '');
    return {
      'access-control-allow-origin': allow,
      'access-control-allow-headers': 'content-type,authorization',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-max-age': '86400'
    };
  }

  async function accepting() {
    if (String(env.KILL_SWITCH || '') === '1') return { ok: false, reason: 'kill_switch' };
    if (await store.spend() >= dailyCap) return { ok: false, reason: 'spend_cap' };
    return { ok: true, reason: null };
  }

  async function requireToken(req) {
    const auth = req.headers.get('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token) throw new ApiError('invalid_token');
    const row = await store.get(token);
    if (!row) throw new ApiError('invalid_token');
    return { token, row };
  }

  return async function handle(req) {
    const origin = req.headers.get('origin') || '';
    const headers = cors(origin);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });

    const url = new URL(req.url);
    try {
      /* ---- health ---------------------------------------------------------- */
      if (url.pathname === '/v1/health' && req.method === 'GET') {
        const a = await accepting();
        return json({
          status: a.ok ? 'ok' : 'degraded',
          accepts_analysis: a.ok,
          reason: a.reason,
          catalogue_version: catalogue.version,
          provider: adapter.name
        }, 200, headers);
      }

      /* ---- token ----------------------------------------------------------- */
      if (url.pathname === '/v1/token' && req.method === 'POST') {
        const body = await req.json().catch(() => ({}));
        if (env.TURNSTILE_SECRET && !(await verifyTurnstile(env.TURNSTILE_SECRET, body.turnstile_token))) {
          throw new ApiError('bad_request', { detail: 'turnstile' });
        }
        const t = await store.issue();
        return json(t, 200, headers);
      }

      /* ---- analyze --------------------------------------------------------- */
      if (url.pathname === '/v1/analyze' && req.method === 'POST') {
        const a = await accepting();
        if (!a.ok) throw new ApiError('service_degraded');

        const { token, row } = await requireToken(req);
        if (!(await store.rateOk(token))) throw new ApiError('rate_limited', { retryAfter: 30 });

        const body = await req.json().catch(() => { throw new ApiError('bad_request'); });

        if (!body.consent || body.consent.scope !== 'single_document') throw new ApiError('consent_missing');
        if (!body.image) throw new ApiError('bad_request', { detail: 'image' });

        const mediaType = body.media_type || 'image/jpeg';
        if (!MEDIA_TYPES.includes(mediaType)) throw new ApiError('unsupported_media_type');
        /* base64 inflates by 4/3; check the decoded size, not the string */
        if (body.image.length * 0.75 > MAX_IMAGE_BYTES) throw new ApiError('image_too_large');

        if (row.used >= row.limit) throw new ApiError('quota_exhausted');

        const out = await analyze({ image: body.image, mediaType, hint: body.hint });

        await store.addSpend(out.costUsd || 0);
        const quota = out.credits
          ? await store.charge(token, out.credits)
          : store.quotaOf(await store.get(token));

        /* Log the shape, never the content. This object is the whole log record. */
        console.log(JSON.stringify({
          ev: 'analyze', source: out.meta.source, model: out.meta.model,
          escalated: out.meta.escalated, credits: out.meta.credits_charged,
          conf: out.result.confidence, latency_ms: out.meta.latency_ms,
          in: out.meta.input_tokens, out: out.meta.output_tokens,
          cached: out.meta.cache_read_tokens, usd: +(out.costUsd || 0).toFixed(5)
        }));

        return json({ result: out.result, meta: { ...out.meta, quota } }, 200, headers);
      }

      /* Anything that is not the API is the app itself. Serving both from one
         Worker is what removes the CORS configuration and the hand-wired endpoint. */
      if (req.method === 'GET' || req.method === 'HEAD') {
        const asset = await serveAsset(req, { assets, endpoint: '' });
        if (asset && asset.status !== 404) return asset;
      }

      return json({ error: { code: 'bad_request', message_he: 'לא נמצא.' } }, 404, headers);
    } catch (err) {
      if (!(err instanceof ApiError)) console.log(JSON.stringify({ ev: 'error', msg: String(err && err.message) }));
      const res = errorResponse(err);
      Object.entries(headers).forEach(([k, v]) => res.headers.set(k, v));
      return res;
    }
  };
}

async function verifyTurnstile(secret, token) {
  if (!token) return false;
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret, response: token })
    });
    const d = await r.json();
    return !!d.success;
  } catch { return false; }
}

/* Worker default export. The catalogue is bundled at build time — it is generated
   from index.html, so it ships with the code rather than being fetched. */
import catalogue from '../contracts/catalogue.json' with { type: 'json' };

let app;
export default {
  fetch(req, env) {
    app = app || createApp({ catalogue, env });
    return app(req);
  }
};
