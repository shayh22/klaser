# Klaser — handover

**State as of commit `b2dc52f` on `main`. 395 assertions, 0 failures (`node tests/run.mjs`).**

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
  adapters/anthropic.js real provider — raw HTTP, never yet executed (see below)
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
| Worker code | **written and tested**, never deployed |
| Anthropic adapter | **never executed against the real API** |
| Cloudflare | account exists; nothing deployed yet |
| ZDR agreement | not signed |
| Evaluation set | **does not exist** — the real blocker |

### The immediate next step

`docs/DEPLOY-FROM-PHONE.md` — the whole path in a browser, no terminal: Anthropic
key → connect the repo to Cloudflare (it builds on push) → paste the secret. D1 is
optional and deliberately commented out so the first deploy needs no setup.

Then `tools/probe-live.mjs` (or the deployed logs) for the first real call. **Expect
it to fail in some specific way** — see below.

### What is unverified

The Anthropic adapter's request *shape* is asserted (`tests/adaptertest.mjs`, 23
assertions: block types for images and PDFs, `cache_control` on the catalogue and not
the prompt, schema enums from the catalogue, headers, budgets). Assertions about a
request are not a response. Likely first failures, in order:

1. `output_config.format` shaped differently than documented
2. Structured output not in the first text block (Opus 5 emits thinking blocks first)
3. The Hebrew prompt underperforming on a real letter
4. `max_tokens` too tight once thinking is on

`ApiError` keeps the upstream body server-side precisely so these are diagnosable;
the browser only ever sees a code and a Hebrew message, and a test asserts the error
response has exactly three keys.

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
  in the photo library — the common case. Removed from `#letterInput`;
  **`#scanInput` still has it** and has the same problem.
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
2. Sign the zero-data-retention agreement before a single real person's letter is sent.
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
node tests/run.mjs                              # 395 assertions
node server/dev.js                              # mock provider, no key needed
ANTHROPIC_API_KEY=sk-ant-… node server/dev.js   # real models
ANTHROPIC_API_KEY=sk-ant-… node tools/probe-live.mjs [letter.jpg]
node tools/extract-catalogue.mjs                # regenerate after editing index.html
```

Open `index.html` directly for the app alone — no build, no server, feature off.
