# Turning on real analysis

Everything below is operational. No application code needs writing — the pipeline,
the client, the consent flow and the tests are done. What is missing is an API key,
somewhere to run, and one thing nobody can shortcut: evidence that it reads Hebrew
letters correctly.

## The five steps

### 1. A provider key — 5 minutes

Create a key at <https://openrouter.ai> (or console.anthropic.com to talk to
Anthropic directly). The key alone switches the provider: the server picks OpenRouter
when `OPENROUTER_API_KEY` is set, Anthropic when only `ANTHROPIC_API_KEY` is, and the
mock when neither is. There is no flag to set alongside it — a key with no provider
configured to use it is the deploy mistake this design removes.

Try it locally before deploying anything:

```bash
OPENROUTER_API_KEY=sk-or-… node server/dev.js
# then open http://localhost:8787 — the endpoint is injected into the page
```

This is the moment an adapter runs for the first time. Budget for a round of fixes
here — see "what is unverified" below. `docs/API-KEY.md` has the detail, including
what each request costs.

### 2. Retention — before any real letter

Through OpenRouter this is per request rather than per contract, and it is already
on: every call carries `zdr: true` and `data_collection: "deny"`, so the request is
only routed to endpoints that neither retain the letter nor train on it. Nothing to
sign, but do read what those two mean in `docs/API-KEY.md` — they are not the same
guarantee, which is why both are set.

Talking to Anthropic directly instead, ask for a ZDR agreement on the account. Do it
**before** photographing a real letter belonging to a real person, not after. It is
also what keeps `claude-fable-5` out of scope, since that model requires 30-day
retention.

Testing with letters you wrote yourself needs no agreement either way. Testing with
someone else's ביטוח לאומי letter does.

### 3. Cloudflare — one command

```bash
npx wrangler login      # once, opens a browser
./tools/deploy.sh       # everything else
```

The script checks who you are, verifies the catalogue is in step with the app,
creates the D1 database and writes its id into `wrangler.toml`, applies the
migration, tells you whether the API key is set, and deploys. It is safe to re-run:
it creates what is missing and leaves what exists alone.

**The app and the API deploy together, on one origin.** That is what removes the
CORS configuration and the hand-wired endpoint — the Worker serves the page and then
tells it where the API is, so the same build works on the preview URL, on production
and on localhost with no hostname baked in anywhere.

The one setting that matters is `run_worker_first = true` under `[assets]`. Without
it Cloudflare serves the static files directly, the Worker never sees the HTML, and
the feature stays switched off with no error to explain why.

### 4. Point the app at it — nothing to do on Cloudflare

Deployed from the Worker, the page is configured for you. Open the printed URL on
your phone and the scan button is there.

The line is only needed when the app is hosted somewhere else — GitHub Pages, say —
and should talk to a Worker on a different origin:

```html
<script>window.KLASER_AI_ENDPOINT = 'https://klaser.<you>.workers.dev';</script>
```

Without it the feature does not exist, which is the default for the GitHub Pages copy
and keeps that copy making no network requests at all.

### 5. Evidence it works — the long one

This is the real gate and it is unchanged from the roadmap: **40+ real Hebrew agency
letters, de-identified, hand-labelled**, run through `evals/` with thresholds of
recall ≥ 0.90, false-add ≤ 0.05, agency ≥ 0.95, deadline exact ≥ 0.90.

Everything above can be done in an afternoon. This cannot, and nothing should ship
to other people before it exists — a wrong checklist sends someone to the wrong
counter with the wrong papers.

## What is unverified, honestly

**Neither adapter has ever executed.** Their request shapes are asserted — 23
assertions for Anthropic, 65 for OpenRouter, covering content-block types, cache
placement, schema enums, routing preferences and headers — but an assertion about a
request is not a response. Run `tools/probe-live.mjs` first; it exercises the exact
selection the Worker uses.

Expect to fix things in this order, on the OpenRouter path:

| Risk | Why | Where |
|---|---|---|
| A model slug has been renamed | OpenRouter renames faster than this repo deploys, and a stale slug is a 404 | `OPENROUTER_MODEL_*` vars — no deploy needed |
| "No allowed providers" | `zdr` + `data_collection: deny` + `require_parameters` can between them leave no route for a given model | widen knowingly, or change model |
| Strict-mode schema rejected | OpenAI strict mode is narrower than the schema we build; `normaliseSchema()` translates it, from documentation | `server/adapters/openrouter.js` |
| A PDF read as a blank page | The `file` part and the `file-parser` plugin must both be right; a wrong one does not error | probe a PDF separately from an image |
| Hebrew prompt underperforms | Never seen a real letter | `server/prompts.js` |

And on the Anthropic path: `output_config.format` shaped differently than
documented, structured output arriving after a thinking block, `max_tokens` too tight
once thinking is on.

Two of these are the same class of bug and only one has been caught so far: PDFs need
a `document` block on the Anthropic path and a `file` part on the OpenRouter one, and
the mock could never have caught either, because the mock never sees a request.

The safety net for the rest is `server/validate.js`: whatever a provider answers, an
invented document key, an unquoted document or a deadline that is not a date is
dropped before it can reach anyone's case. `meta.dropped` counts what it refused, so
a provider that quietly stops honouring the schema is visible in the logs rather than
in somebody's checklist.

## What it will cost while you test

Roughly **$0.03 per letter** on a Sonnet-class model. A hundred test letters is about $3. The
daily spend cap in `wrangler.toml` defaults to $25, and the kill switch
(`KILL_SWITCH=1`) stops the service accepting work without taking the app down —
clients fall back to local-only and carry on.
