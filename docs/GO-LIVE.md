# Turning on real analysis

Everything below is operational. No application code needs writing — the pipeline,
the client, the consent flow and the tests are done. What is missing is an API key,
somewhere to run, and one thing nobody can shortcut: evidence that it reads Hebrew
letters correctly.

## The five steps

### 1. Anthropic API key — 5 minutes

Create a key at console.anthropic.com. That alone switches the provider: the server
picks the Anthropic adapter when `ANTHROPIC_API_KEY` is set, and the mock when it is
not. Nothing else changes.

Try it locally before deploying anything:

```bash
ANTHROPIC_API_KEY=sk-ant-… node server/dev.js
# then open index.html with window.KLASER_AI_ENDPOINT = 'http://localhost:8787'
```

This is the moment the adapter runs for the first time. Budget for a round of
fixes here — see "what is unverified" below.

### 2. Zero data retention — before any real letter

Ask Anthropic for a ZDR agreement on the account. Do this **before** photographing a
real letter belonging to a real person, not after. It is also what keeps
`claude-fable-5` out of scope, since that model requires 30-day retention.

Testing with letters you wrote yourself needs no agreement. Testing with someone
else's ביטוח לאומי letter does.

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

The Anthropic adapter has never executed. Its request shape is asserted
(`tests/adaptertest.mjs`, 23 assertions: block types, cache placement, schema enums,
headers), but assertions about a request are not the same as a response.

Expect to fix things in this order:

| Risk | Why | Where |
|---|---|---|
| `output_config.format` rejected or shaped differently | Written from documentation, never called | `server/adapters/anthropic.js` |
| Structured output arrives somewhere other than the first text block | Opus 5 thinks by default and emits thinking blocks first | the response parser in the same file |
| Hebrew prompt underperforms | Never seen a real letter | `server/prompts.js` |
| `max_tokens` too tight once thinking is on | Thinking shares the budget | adapter, already raised to 8000 for Opus |

A PDF bug of exactly this kind was already found and fixed without a key: PDFs need a
`document` content block, not an `image` one, and the mock could never have caught it
because the mock never sees a request.

## What it will cost while you test

Roughly **$0.03 per letter** on Sonnet 5. A hundred test letters is about $3. The
daily spend cap in `wrangler.toml` defaults to $25, and the kill switch
(`KILL_SWITCH=1`) stops the service accepting work without taking the app down —
clients fall back to local-only and carry on.
