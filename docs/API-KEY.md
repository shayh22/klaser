# Getting an API key

The service talks to one of two things, and it works out which by seeing which key is
present. There is no third setting to remember.

| | |
|---|---|
| `OPENROUTER_API_KEY` | one key, many models — **this is what the deployment uses** |
| `ANTHROPIC_API_KEY` | talking to Anthropic directly |
| neither | the mock answers with Hebrew fixtures; the app is otherwise identical |

If both are set, OpenRouter wins. `AI_PROVIDER` overrides that, and is the only
reason to set it.

---

## OpenRouter

### Where

<https://openrouter.ai> → sign in → **Credits** → add credit → **Keys** → *Create Key*.

Set a **credit limit on the key itself** while you are creating it, not afterwards.
$5 is more than enough for the whole bring-up. The key looks like `sk-or-v1-…` and is
shown once.

Per-token prices match the upstream provider's own; OpenRouter takes its margin when
you buy credit rather than per request, so the cost table below holds either way.

### Why this one

Not for the model list. The letter is somebody's benefits claim, and OpenRouter is
the only one of the two where *which company ends up holding it* is a per-request
routing decision rather than a contract. Every request this service makes carries:

```json
"provider": { "require_parameters": true, "data_collection": "deny", "zdr": true }
```

- `zdr` — only endpoints with a zero-retention policy.
- `data_collection: "deny"` — only providers that do not store or train on the input.
  These two are **not** the same thing, and a provider can satisfy one without the
  other, which is why both are set.
- `require_parameters` — only providers that honour the JSON schema. Without it a
  request can be routed to somewhere that ignores `response_format` and answers in
  prose, and a read the user paid for comes back empty.

All three default on. `OPENROUTER_ZDR=0` and `OPENROUTER_DATA_COLLECTION=allow` turn
the first two off, and nothing else does — an unset or empty variable leaves them on.
If a deploy starts returning **"no allowed providers"**, that is these doing their
job: change model, or widen them knowing exactly what you are widening.

### The models

Set in `server/adapters/openrouter.js`, overridable per deployment because
OpenRouter's slugs get renamed more often than this repository gets deployed, and a
renamed slug is a 404 rather than a fallback:

| stage | default | why |
|---|---|---|
| identify | `anthropic/claude-haiku-4.5` | is this a letter at all, and which form |
| read | `anthropic/claude-sonnet-4.5` | the actual reading |
| escalate | `anthropic/claude-opus-4.5` | only when the read came back unsure |

Override with `OPENROUTER_MODEL_IDENTIFY` / `_READ` / `_ESCALATE`. The reasoning
behind the split is in `docs/MODEL-OPTIONS.md`; nothing there depends on the gateway.

---

## Anthropic direct

**console.anthropic.com** — a separate account from claude.ai. A Claude Pro or Max
subscription does **not** include API access; the API is billed separately, by usage.

1. Sign up or sign in at <https://console.anthropic.com>
2. **Billing → Add credits.** The API is prepaid; the minimum is around $5.
3. **Billing → Limits → set a monthly spend limit.** Do this before creating the key,
   not after. $10 is a sensible ceiling for testing.
4. **API keys → Create Key.** Name it something you will recognise later, e.g.
   `klaser-dev`. **The key is shown once.**

The key looks like `sk-ant-api03-…`.

---

## What testing actually costs

About **$0.03 per letter** on a Sonnet-class model — roughly ₪0.11. Concretely:

| | |
|---|---|
| One probe run | ~$0.03 |
| Fifty letters while tuning the prompt | ~$1.50 |
| The full 40-letter evaluation set, ten times over | ~$12 |

$5 of credit covers the whole bring-up with room to spare. The Worker also carries a
daily spend cap (`DAILY_SPEND_CAP_USD`, default $25) so a bug cannot run up a bill.
Through OpenRouter that cap counts **what was actually charged** — the gateway
reports the real cost per request — rather than a price table that goes stale the day
a model is repriced.

## Can I test on the free models?

Short answer: **no, not with this service's routing on** — and buying $5 of credit is
the cheaper path anyway.

`:free` model endpoints are free largely because the provider may log, train on, or
publish what you send them. That is the opposite of what every request here asks for,
so `zdr: true` + `data_collection: "deny"` filters all of them out and the gateway
returns a 404 reading *"No endpoints available matching your guardrail restrictions
and data policy"*. OpenRouter has a support article about exactly that 404. It is not
a broken key.

The free tier is also capped at **20 requests a minute and 50 a day** until $10 of
credit has been bought once (which permanently raises the daily cap to 1,000), and
each letter costs two requests. And the free roster rarely overlaps with what this
needs at all: vision **and** strict structured output **and** decent Hebrew.

So:

- **To check the plumbing without spending anything meaningful** — `npm run preflight`
  below costs a fraction of a cent and answers every question a free model would have.
- **To test on letters you wrote yourself**, free models are fine if you relax the
  routing deliberately:

  ```bash
  OPENROUTER_ZDR=0 OPENROUTER_DATA_COLLECTION=allow \
    OPENROUTER_MODEL_READ=… OPENROUTER_API_KEY=sk-or-… node tools/preflight.mjs
  ```

  **Never with a real person's letter.** Those two variables are the entire privacy
  position of this product; turning them off sends somebody's benefits claim to a
  provider that may publish it. Only ever set them on a command line, never in the
  Cloudflare dashboard.

## First run — 30 seconds, a fraction of a cent

```bash
cd klaser
OPENROUTER_API_KEY=sk-or-… npm run preflight
```

Five questions, asked separately so each answer is unambiguous: is the key valid and
funded, does each model slug still exist, does the privacy routing leave any provider
able to serve it, does the read model accept an image, and does it accept a PDF. Each
failure prints the thing to change rather than a status code.

The last two matter most. A too-narrow routing policy returns a 404 that reads like a
missing model, and a wrong PDF shape returns a confident answer about a blank page —
neither is obvious from the pipeline's own error.

## Then the real thing

```bash
OPENROUTER_API_KEY=sk-or-… node tools/probe-live.mjs
```

That makes one real call through the exact code path the deployed Worker uses — it
picks the provider by the same function — on the test image in `tests/`, and prints
the model, tokens, cost, latency, the parsed result, and a sanity check that every
document is a real catalogue key.

A real letter instead, or a PDF, which takes a different path through the request and
is worth probing on its own:

```bash
OPENROUTER_API_KEY=sk-or-… node tools/probe-live.mjs ~/Desktop/letter.jpg
OPENROUTER_API_KEY=sk-or-… node tools/probe-live.mjs ~/Desktop/letter.pdf
```

Read the `dropped` line. It counts how much of the answer the catalogue check refused
— an invented document key, a document with nothing quoted behind it, a deadline that
was not a date. **Zero is the expected number.** Anything else on a first run means
the schema is being asked for but not enforced, and the model is worth changing
before anything else is tuned.

If the request is rejected, the probe prints the upstream response verbatim — which
field it objected to and why. That output is what makes the failure fixable. The key
itself is never printed (only its last four characters), and no part of the image is
printed.

## About sharing the key

If you want the bring-up done for you, the safe pattern is not to hand over a key at
all — run the probe yourself and paste the output. It contains no secret, and it
carries everything needed to diagnose a failure.

If you do decide to share one:

- **Create a key used for nothing else**, with a low credit limit.
- **Revoke it when the work is done.** Revoking is instant and cannot be undone,
  which is the point.
- Remember that anything pasted into a chat stays in that transcript, and this
  container is rebuilt from the repository each session — a key left in a file here
  does not survive, but a key in a message does.

Never commit a key. `wrangler secret put OPENROUTER_API_KEY` is how it reaches
production, or the **Settings → Variables and Secrets** panel in the Cloudflare
dashboard; it is never written to `wrangler.toml`.

## Then what

`docs/GO-LIVE.md` picks up from here: retention, deploying the Worker, and the one
step that cannot be rushed — the evaluation set.
