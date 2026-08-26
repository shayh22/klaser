/* Klaser cloud service — Worker entry point.
 *
 * Three routes. No route stores a document, and none can: nothing here writes to a
 * bucket, and the only table is a credit counter.
 */

import { ApiError, errorResponse, json } from './errors.js';
import { MemoryStore, D1Store } from './store.js';
import { sanitiseExtras } from './validate.js';
import { runPreflight } from './diagnose.js';
import { DEFAULT_MODELS } from './adapters/openrouter.js';
import { createAnalyzer } from './analyze.js';
import { createAnthropicAdapter } from './adapters/anthropic.js';
import { createOpenRouterAdapter } from './adapters/openrouter.js';
import { createMockAdapter } from './adapters/mock.js';
import { serveAsset } from './assets.js';

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MEDIA_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const DEFAULT_DAILY_CAP_USD = 25;

export function createApp({ catalogue, env = {}, store, adapter, lookup, assets, fetchImpl }) {
  assets = assets || env.ASSETS;
  const dailyCap = Number(env.DAILY_SPEND_CAP_USD || DEFAULT_DAILY_CAP_USD);
  const origins = String(env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());

  store = store || (env.DB
    ? new D1Store(env.DB, { freeCredits: Number(env.FREE_CREDITS || 10) })
    : new MemoryStore({ freeCredits: Number(env.FREE_CREDITS || 10) }));

  adapter = adapter || chooseAdapter(env);

  const analyze = createAnalyzer({ adapter, catalogue, lookup });
  /* Coarse, per-instance, and deliberately not in the store: this only needs to stop
     someone holding the button down, and a check that costs a tenth of a cent does
     not deserve a database round trip. */
  let lastPreflight = 0;

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
          provider: adapter.name,
          /* Why that provider, not just which one.
             "provider: mock" on a deployment that has a key configured is the most
             confusing state this service has: it looks identical whether the secret
             was never saved, was saved as a plain variable and then overwritten by
             the [vars] block on the next deploy, was put in the build-time
             environment where the runtime cannot see it, or whether AI_PROVIDER
             overrode everything. Each has a different fix and none is visible from
             the outside.
             Presence only — a boolean about configuration, never a value, and
             nothing here that `provider` did not already imply. */
          config: {
            openrouter_key: !!env.OPENROUTER_API_KEY,
            anthropic_key: !!env.ANTHROPIC_API_KEY,
            ai_provider: String(env.AI_PROVIDER || '') || null,
            db: !!env.DB
          }
        }, 200, headers);
      }

      /* ---- preflight --------------------------------------------------------
         Why the analysis is failing, asked one question at a time. /v1/analyze is
         a two-call pipeline behind a gateway and the browser is shown a Hebrew
         sentence rather than the upstream's words — deliberately, but it leaves the
         owner of a deployment guessing between six unrelated causes.

         Open to anyone who can reach the service, because it exposes only whether
         each check passed and our own advice about it, never a key and never a
         letter. It does spend a little money, so it is bounded three ways: the
         daily cap applies, its cost is recorded like any other, and a Worker
         instance will not run it twice inside a minute. */
      if (url.pathname === '/v1/preflight' && (req.method === 'GET' || req.method === 'POST')) {
        if (adapter.name !== 'openrouter') {
          return json({ error: { code: 'bad_request',
            message_he: 'הבדיקה הזו רלוונטית רק כששירות הניתוח מוגדר מול OpenRouter.',
            provider: adapter.name } }, 400, headers);
        }
        const a = await accepting();
        if (!a.ok) throw new ApiError('service_degraded');
        const now = Date.now();
        if (now - lastPreflight < 60_000) throw new ApiError('rate_limited', { retryAfter: 60 });
        lastPreflight = now;

        const out = await runPreflight({
          apiKey: env.OPENROUTER_API_KEY,
          models: {
            identify: env.OPENROUTER_MODEL_IDENTIFY || DEFAULT_MODELS.identify,
            read:     env.OPENROUTER_MODEL_READ     || DEFAULT_MODELS.read,
            escalate: env.OPENROUTER_MODEL_ESCALATE || DEFAULT_MODELS.escalate
          },
          zdr: String(env.OPENROUTER_ZDR ?? '1') !== '0',
          dataCollection: String(env.OPENROUTER_DATA_COLLECTION || 'deny'),
          pdfEngine: env.OPENROUTER_PDF_ENGINE || 'native',
          /* The same injection seam the adapter has, so the failure paths can be
             driven in a test instead of described in a comment. */
          ...(fetchImpl ? { fetchImpl } : {})
        });
        await store.addSpend(out.spent_usd || 0);
        console.log(JSON.stringify({ ev: 'preflight', ok: out.ok,
          failed: out.checks.filter(c => !c.ok).map(c => c.name), usd: out.spent_usd }));
        return json(out, 200, headers);
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

        /* The user's own agency and document names, sent with their own document so
           the model can recognise next month what they named this month. Bounded and
           scrubbed before it goes anywhere near a prompt, and stored nowhere: it
           arrives with the request and leaves with the response. */
        const extras = sanitiseExtras(body.extras);

        const out = await analyze({ image: body.image, mediaType, hint: body.hint, extras });

        await store.addSpend(out.costUsd || 0);
        const quota = out.credits
          ? await store.charge(token, out.credits)
          : store.quotaOf(await store.get(token));

        /* Log the shape, never the content. This object is the whole log record. */
        console.log(JSON.stringify({
          ev: 'analyze', source: out.meta.source, model: out.meta.model,
          escalated: out.meta.escalated, credits: out.meta.credits_charged,
          /* How much of the answer the catalogue check refused. Zero on every
             healthy request, which is what makes a non-zero one worth alerting on:
             it is a provider that stopped honouring the schema, seen here rather
             than in somebody's checklist. */
          dropped: out.meta.dropped || 0,
          /* How much vocabulary this user brought. A count, never the names. */
          extra_agencies: (extras && extras.agencies || []).length,
          extra_docs: (extras && extras.docs || []).length,
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

/* Which provider answers, decided by which key is present rather than by a flag
   somebody has to remember to set alongside it. A key with no provider to use it is
   the failure mode worth designing out: pasting the secret is the whole deploy.
   AI_PROVIDER exists for the one case the keys cannot express — both keys set, and
   a deliberate choice between them.
   With no key at all this is the mock, which is why the suite runs with no key and
   why a misconfigured deploy degrades to fixtures rather than to a 500. */
export function chooseAdapter(env = {}) {
  const want = String(env.AI_PROVIDER || '').trim().toLowerCase();

  if (want === 'mock') return createMockAdapter();
  if ((want === 'openrouter' || (!want && env.OPENROUTER_API_KEY)) && env.OPENROUTER_API_KEY) {
    return createOpenRouterAdapter({
      apiKey: env.OPENROUTER_API_KEY,
      /* Every knob here is a var rather than a constant because each one is a way
         a deploy can be wrong in a way only the deploy knows about: a renamed
         model slug, a PDF engine that reads scans better, or a privacy filter so
         narrow it leaves no provider able to serve the request at all. */
      models: {
        ...(env.OPENROUTER_MODEL_IDENTIFY ? { identify: env.OPENROUTER_MODEL_IDENTIFY } : {}),
        ...(env.OPENROUTER_MODEL_READ     ? { read:     env.OPENROUTER_MODEL_READ }     : {}),
        ...(env.OPENROUTER_MODEL_ESCALATE ? { escalate: env.OPENROUTER_MODEL_ESCALATE } : {})
      },
      ...(env.OPENROUTER_PDF_ENGINE ? { pdfEngine: env.OPENROUTER_PDF_ENGINE } : {}),
      ...(env.OPENROUTER_SITE_URL ? { referer: env.OPENROUTER_SITE_URL } : {}),
      /* Default on, and only an explicit "0" turns them off: a letter reaching a
         provider that retains it is the one failure this service must not have. */
      zdr: String(env.OPENROUTER_ZDR ?? '1') !== '0',
      dataCollection: String(env.OPENROUTER_DATA_COLLECTION || 'deny')
    });
  }
  if (env.ANTHROPIC_API_KEY) return createAnthropicAdapter({ apiKey: env.ANTHROPIC_API_KEY });
  return createMockAdapter();
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
