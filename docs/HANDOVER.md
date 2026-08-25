# Klaser — handover

**529 assertions, 0 failures (`node tests/run.mjs`).**

Read this first; everything else is linked from here.

---

## What it is

A single-page tool for tracking Israeli bureaucracy: which case is at which stage,
which documents are still missing, and — the part that trips people up — **what the
thing is called in Hebrew**. Four interface languages (he/fr/en/ru), and every agency,
document and term carries its Hebrew name plus transliteration *in every language*, so
the phone can be handed to a clerk.

Built for anyone who finds Israeli forms hard, especially Olim Hadashim.

**Live (static, AI off):** <https://shayh22.github.io/klaser/>
**Demo (canned AI answer, no server):** <https://claude.ai/code/artifact/2de314e3-ebcc-4836-a606-5584ed0baee1>

## What was added on top of the original app

Two features, both **off unless an endpoint is configured**:

1. **Read a letter** — photograph a letter from an agency, get a document checklist
   built from it. Each suggestion carries the Hebrew sentence in the letter it came
   from. Nothing is written until the user ticks it; one tap undoes the lot.
2. **Fill the form** — once documents are collected, fill the form. **This half sends
   nothing at all.**

---

## The two ideas everything else follows from

**1. Split trust.** Reading a letter needs the letter. Filling a form needs to know
what the *blank* form asks, not the answers. So the field map is public reference
data, the answers live in a profile in the browser, and the join happens on-device.
There is no endpoint that accepts a profile — `tests/mvptest.mjs` asserts at the
network level that no request ever carried one.

**2. The model returns catalogue keys, not prose.** It is given the app's own
`AGENCIES`/`DOCS`/`TEMPLATES` and answers with keys from them. Consequences: a
hallucinated document name is structurally impossible on the main path; all four
languages render for free (the client translates the keys); and the output is exactly
evaluable.

---

## Layout

```
index.html              the whole app — no build, no dependencies, no framework
server/                 Cloudflare Worker: serves the app AND the API from one origin
  index.js              router: /v1/health, /v1/token, /v1/analyze, else static
  analyze.js            identify (Haiku) → catalogue lookup → read (Sonnet)
  prompts.js            Hebrew system prompts + the schema built from the catalogue
  validate.js           the catalogue check applied to the answer, not just asked for
  adapters/openrouter.js  the gateway — one key, many models; the deployed path
  adapters/anthropic.js   Anthropic direct — raw HTTP, never yet executed (see below)
  adapters/mock.js      realistic Hebrew fixtures; why the suite runs with no key
  store.js              credits + daily spend. D1 in prod, memory otherwise
  assets.js             serves the page and injects the endpoint into it
tools/
  extract-catalogue.mjs generates contracts/catalogue.json FROM index.html
  probe-live.mjs        one real API call, reported in detail
  build-dist.mjs        assembles dist/ for deploy
  build-demo.mjs        packages the standalone demo page
tests/run.mjs           runs everything, one number
```

**The catalogue is generated, never hand-written.** `--check` fails CI when
`contracts/catalogue.json` falls behind `index.html`. Two catalogues would drift the
first time someone added a document to one of them.

---

## Where it stands

| | |
|---|---|
| App | **shipped**, live on Pages, feature off there by design |
| Worker code | **written and tested**, deployed on Cloudflare |
| OpenRouter adapter | written, 65 assertions, **never executed against the real API** |
| Anthropic adapter | **never executed against the real API** |
| Retention | enforced per request through routing, not by contract — see below |
| Evaluation set | **does not exist** — the real blocker |

### Which provider answers

Decided by which key is present, never by a flag someone has to set alongside it:
`OPENROUTER_API_KEY` → the gateway, `ANTHROPIC_API_KEY` → Anthropic direct, neither
→ the mock. `AI_PROVIDER` exists only to break a tie when both are set. A misconfigured
deploy therefore serves fixtures rather than errors, and `/v1/health` says which.

Going through a gateway buys two things beyond the model list:

- **Retention is a routing decision, per request, not a contract.** Every call
  carries `zdr: true` and `data_collection: "deny"` — separate guarantees, hence both
  — plus `require_parameters: true`, which keeps the request away from any provider
  that would ignore the schema and answer in prose. All three default on; only an
  explicit `0`/`allow` turns the first two off.
- **The spend cap counts real money.** OpenRouter reports what it actually charged,
  so the cap no longer depends on a price table that goes stale on a repricing.

The cost is that the schema is no longer enforced by the same service that generates
the tokens. That is what `server/validate.js` is for.

### The immediate next step

`tools/probe-live.mjs` — one real call through the exact selection the Worker uses.
**Expect it to fail in some specific way** — see below. Read the `dropped` line:
anything but 0 on a first run means the schema is being asked for and not enforced.

### What is unverified

**Neither adapter has ever executed.** Both request *shapes* are asserted — 23
assertions for Anthropic, 65 for OpenRouter — covering content-block types for images
and PDFs, `cache_control` on the catalogue and not the prompt, schema enums from the
catalogue, routing preferences, headers and budgets. Assertions about a request are
not a response. Likely first failures on the gateway path:

1. A renamed model slug — a 404, fixed with an `OPENROUTER_MODEL_*` var, no deploy
2. "No allowed providers" — the retention filters doing their job for a model that
   has no compliant endpoint; change model rather than widening them by reflex
3. Strict-mode schema rejected — `normaliseSchema()` translates ours, from docs
4. A PDF read as a blank page — the `file` part or the plugin wrong, and neither errors
5. The Hebrew prompt underperforming on a real letter

And on the Anthropic path: `output_config.format` shaped differently than documented,
structured output not in the first text block (Opus 5 emits thinking blocks first),
`max_tokens` too tight once thinking is on.

`ApiError` keeps the upstream body server-side precisely so these are diagnosable;
the browser only ever sees a code and a Hebrew message, and a test asserts the error
response has exactly three keys.

### The catalogue check — why a third layer exists

The claim that "a hallucinated document name is structurally impossible" used to rest
entirely on the schema in the request. That holds when the schema is enforced by the
same service producing the tokens. Through a gateway it is not: the request *names* a
schema, and whether it was enforced depends on which provider answered. Strict-mode
JSON Schema also cannot express half of ours — lengths, ranges and item caps are
dropped on the way out.

So the guarantee moved somewhere it cannot be routed around. `server/validate.js`
runs on our side, after the answer and before anything is returned:

- a document key not in the catalogue is **dropped**, never renamed or guessed at
- a document with nothing quoted from the letter is dropped — rule 2 of the prompt,
  enforced rather than requested
- a deadline that is not a real calendar date becomes `null`; the client writes that
  field straight onto the case, so a wrong one is worse than none
- ranges and lengths are re-applied; an agency or process outside the catalogue is `null`

`meta.dropped` counts what it refused. Zero is the normal case, and it is the number
the evaluation set exists to watch: a provider that stops honouring the schema shows
up in the logs before it shows up in somebody's checklist.

---

## Decisions already made

Each has a stated trigger for reopening; none is silently permanent.

- **Models:** Haiku 4.5 identifies, Sonnet 5 reads, Opus 5 escalates and builds form
  maps. Reopen only at >25k reads/month, or if a model reaches within 2 points of
  recall at half the cost, or if the retention position changes. Fable 5 is excluded
  outright — it requires 30-day retention.
- **Three answer layers:** template (free, never reaches the server) · catalogue
  (free) · read (1 credit). Below a **33.3%** catalogue hit rate the identify pass
  costs more than it saves — so ship layer 2 alone and switch layer 1 on above ~35%.
- **Pricing:** one credit = one letter that had to be read. Failed reads cost nothing.
  Credits never expire mid-process.
- **Privacy:** opt-in per document, no retention anywhere, no account. With AI off the
  app is byte-identical to before — enforced by the pre-existing assertions.

Full reasoning: `docs/CLOUD-AI-PLAN.md`, `docs/MODEL-OPTIONS.md`.
Sequencing and priorities: `docs/ROADMAP.md`.
Risks: `docs/READINESS.md`.

---

## Things that were got wrong once — do not re-break

- **A template matched by title must not skip the read.** It looks like a free
  layer-0 hit but discards the deadline and the אסמכתא that only that letter carries,
  and a loose title match serves a confidently wrong checklist for free. Layer 0 is
  the user picking a process in the app, which never reaches the endpoint.
- **The rate limiter must stay looser than the credit quota**, or a user out of
  credits is told "too many requests" instead of the truth.
- **PDFs are `document` blocks, not `image` blocks.** The mock cannot catch this — it
  never sees a request.
- **The upstream error body must not be discarded** when wrapping provider errors; it
  is the only thing that says which field was wrong.
- **`capture="environment"` forces the camera** and blocks picking a letter already
  in the photo library — the common case, and it makes the emailed PDF unpickable
  entirely. Removed from `#letterInput`, then found still on `#scanInput`. Now gone
  from both, and `tests/scantest.mjs` asserts no file input has it.
- **PDFs are a `file` part on OpenRouter and a `document` block on Anthropic**, and
  the `file-parser` plugin has to be named in the request or the document is dropped
  without an error — the model reads a blank page and returns a confident empty list.
- **The retention filters are not decoration.** `zdr` and `data_collection` are
  separate guarantees and a provider can satisfy one without the other. Widening them
  to make an error go away is a privacy decision, not a config fix.
- **Stripping the document wrappers takes `<meta charset>` with it** — a page of
  Hebrew then renders as mojibake on any host that does not send the charset itself.
- **Test fixtures must not hardcode dates.** One asserted "4 days out" and silently
  rotted.

---

## Open, and blocking

**Only the owner can close these:**

1. **Collect 40+ real Hebrew agency letters**, de-identified, hand-labelled. This
   gates every ship decision and has the longest lead time. Nothing else on this list
   matters as much.
2. Run `tools/probe-live.mjs` once against the real key. Nothing above the mock has
   ever had a real response.
3. Decide liability wording — the current disclaimer covers a hand-written list, not a
   machine-generated one read off the user's own letter.
4. **Backlog B-1** — the state emblem in `docs/og-image.jpg`. Researched, statutes
   quoted, four-language wording drafted (`docs/BACKLOG.md`). Take it off the backlog
   *before* public launch: a service that reads your government letters sits far
   closer to the "acting on behalf of the state" test than a checklist app does.

**Rollout gate (workstream F):** recall ≥ 0.90 · false-add ≤ 0.05 · agency ≥ 0.95 ·
deadline exact ≥ 0.90.

---

## Running it

```bash
node tests/run.mjs                                # 529 assertions
node server/dev.js                                # mock provider, no key needed
OPENROUTER_API_KEY=sk-or-… node server/dev.js     # real models via the gateway
ANTHROPIC_API_KEY=sk-ant-… node server/dev.js     # real models, Anthropic direct
OPENROUTER_API_KEY=sk-or-… node tools/probe-live.mjs [letter.jpg|letter.pdf]
node tools/extract-catalogue.mjs                  # regenerate after editing index.html
```

Open `index.html` directly for the app alone — no build, no server, feature off.
