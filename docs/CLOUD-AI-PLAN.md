# Klaser — cloud and AI migration plan

**v2 · 17 August 2026 · Hebrew only at launch**

Adding two things to Klaser:

1. **Read an incoming letter** — photograph a letter from an agency, get back which
   documents you need to collect, added to the case checklist.
2. **Fill the outgoing form** — once the documents are collected, help complete the form.

Both need a model. Only the first needs to send anything.

---

## 1. The promise this breaks, and how to keep it anyway

The README says: *"Nothing is uploaded. There are no network requests at all, no
analytics and no tracking — which matters, because these are case numbers, ID
documents and immigration records."* A test asserts it. It is the strongest thing
the product says about itself, and the requested feature sends photographs of
documents to a cloud API.

The resolution is that the two halves need different data:

- **Reading an incoming letter** needs the letter — written by the agency, *about*
  the user.
- **Filling an outgoing form** needs to know what the *blank* form asks for. It does
  not need to know the answers.

So:

| | Track A — letters in | Track B — forms out |
|---|---|---|
| What crosses the network | One photographed letter, per-document opt-in | Nothing from the user |
| What the cloud computes | Checklist items, deadline, reference | A field map for the blank form |
| Per what | Per user, per document | Per **form** — once, for everyone |
| Cost | Metered | ~zero, amortised |
| Offline | No | Yes, once the map is downloaded |

The user's ID number, address and status never leave IndexedDB. The device joins the
downloaded field map to the local profile and renders the filled form itself.

## 2. Architecture

```
Device (קלסר, core unchanged)      Edge worker (stateless)            Model
─────────────────────────────      ───────────────────────            ─────
letter photo ─ opt-in, 1 doc ─▶ POST /v1/analyze
                                      │
                                      ├─ identify ─────────────────▶ Haiku 4.5
                                      │   form_code + agency ◀──────
                                      │
                                      ├─ signature hit? ─▶ catalogue ─┐  0 credits
                                      │                               │
                                      └─ miss ─ full read ─────────▶ Sonnet 5 (ZDR)
                                                                      │  1 credit
cases/scans ◀── proposed items ──────────────────────────────────────┘

local profile ─┐
downloaded     ├──▶ fill engine ──▶ filled form, printed on device
field map ─────┘        (never leaves the device)
```

The only arrow crossing the device boundary with user content is the opt-in one.

### The output is keys, not prose

The model is never asked to write a document name. It is given the app's own
catalogue — the `AGENCIES`, `DOCS` and `TEMPLATES` objects already in `index.html` —
and asked to return keys from it, under a strict output schema:

| Field | Type | Why |
|---|---|---|
| `agency` | enum of `AGENCIES` keys | Cannot invent an agency with no phone number and no link |
| `template` | enum of `TEMPLATES` keys, nullable | Reuses the checklist that already exists |
| `required_docs[]` | enum of `DOCS` keys | Each already has four translations and a Hebrew term |
| `extra_docs[]` | free Hebrew text + confidence | The escape hatch, surfaced separately, flagged unverified |
| `deadline` | ISO date, nullable | Feeds the existing deadline warning; exactness is measurable |
| `reference` | string, nullable | The אסמכתא |
| `confidence` | 0–1 | Below threshold: shown, nothing added |

**Consequence:** because the answer is catalogue keys, multi-language support is
finished before it starts. The client renders keys through the existing i18n, so a
French user gets French labels with the Hebrew term beside them on day one — the
model only ever worked in Hebrew. Phase 4 is about accepting letters in other
languages, not translating the answer. It also makes hallucinated document names
structurally impossible on the main path, and makes the feature exactly evaluable.

### Three layers answer a letter, and only one of them costs money

The hand-authored `TEMPLATES` list covers twelve common processes. Real use will not
stay inside it — people photograph municipal letters, a specific department's form, a
one-off request from a caseworker. Those need a checklist built on the fly, and that
is the expensive path. So the service answers in layers:

| Layer | Source | Cost | Charged |
|---|---|---:|---|
| **0 · Template** | `TEMPLATES` in the app — already offline, already translated | 0 | no |
| **1 · Catalogue** | A shared checklist recognised from the letter's form signature | one identify pass | no |
| **2 · Read** | No match — the letter is read in full and a checklist built from it | identify + full read | **1 credit** |

Layer 1 is the new idea and the important one. A standard letter is standard: when
two hundred people photograph the same ארנונה discount letter from עיריית חיפה, the
checklist is the same two hundred times. The first person's read produces it; everyone
after is served a static answer.

**Recognition has to be cheap or the layer is pointless.** The client cannot match a
photograph to a template on its own — reading the page is the whole problem. So the
Haiku pre-check does double duty: instead of only answering "is this an agency
letter", it also returns the `form_code` printed on the page (Israeli correspondence
almost always carries one — `בל/250`, `טופס 101`), the agency, and the Hebrew
heading. The server hashes those into a **form signature** and looks it up. Hit →
serve the stored checklist. Miss → pay for the full read.

**What may be stored, and what may not.** The signature is impersonal by
construction: it identifies the template, not the recipient. Stored against it is a
list of catalogue document keys — nothing else. No image, no name, no reference
number, no dates, no extracted text. A letter the model marks `personalised` — a
caseworker writing about one person's situation — is never promoted regardless of
its signature. Promotion also requires agreement across several independent
sightings plus human review, because one bad extraction promoted unchecked is a wrong
checklist served to everybody who gets that letter.

**This is a flywheel, and it is the product's real asset.** The catalogue grows out
of use rather than authoring: the twelve hand-written processes become hundreds of
recognised letters, the marginal cost per user falls as the userbase grows, and the
data has no value to anyone who has not already accumulated it. It is worth more than
the code.

## 3. Model choice

> **Decided.** Sonnet 5 for the layer-2 read, Haiku 4.5 for the identify pass, Opus 5
> for offline form-map building. Revisit only on a stated trigger — see the end of
> this section. The `analyze()` adapter stays as an eval affordance, not an open
> question.

> **See `docs/MODEL-OPTIONS.md`** for the cross-provider comparison — Gemini, GPT,
> Mistral OCR, and open weights (Qwen3-VL, DictaLM 3.0). Summary: at launch volume
> the entire spread between the cheapest and dearest option is about **$110/month**,
> so cost did not decide this. The provider stays a config value behind one
> `analyze()` adapter so F can measure alternatives, but the decision above is made
> and the default ships.

Requirements: strong Hebrew, vision good enough for a creased phone photo, native
PDF input, structured outputs, prompt caching, zero data retention.

| Model | In $/1M | Out $/1M | Context | Role |
|---|---:|---:|---:|---|
| `claude-haiku-4-5` | 1.00 | 5.00 | 200K | Cheap gate: is this even an agency letter? |
| **`claude-sonnet-5`** | **3.00** | **15.00** | **1M** | **The workhorse — every Track A analysis** |
| `claude-opus-5` | 5.00 | 25.00 | 1M | Escalation on low confidence; building form maps |
| ~~`claude-fable-5`~~ | 10.00 | 50.00 | 1M | Excluded — requires 30-day retention, cannot run under ZDR |

Sonnet 5 is the cheapest tier that reliably reads a photographed Hebrew letter and
carries no retention restriction. Haiku is a third of the price but its job is the
pre-check, not the read — a wrong checklist is worse than no checklist. Opus earns
its price on two cases only: a letter the confidence score already flagged, and the
one-off job of mapping a blank form, which happens once per form for all users.

**Timing:** Sonnet 5 is at introductory pricing of $2/$10 until **31 Aug 2026**. All
figures below use the standard $3/$15 rate. Do not build the business case on intro
pricing.

**This is a single API call, not an agent.** One request, one image, one structured
response. No loop, no tools. The only agentic shape justified anywhere here is the
offline form-map builder, and that is better run as a batch.

### Closing the model question

Decided, so that eight workstreams can start against something concrete:

| Job | Model |
|---|---|
| Identify pass — is this a letter, and which form is it? | `claude-haiku-4-5` |
| Layer-2 read | `claude-sonnet-5` |
| Escalation on low confidence | `claude-opus-5` |
| Offline form-map building (workstream C, batched) | `claude-opus-5`, or a dedicated OCR if C's evaluation prefers it |

Chosen on retention route and on Hebrew being the risk rather than the price — not
because Sonnet 5 is proven best at Hebrew agency letters, since nothing is. The
adapter interface stays so F can measure alternatives, but **the default ships**
rather than waiting for the bake-off.

**Reopen only when one of these fires:**

1. Layer-2 volume passes **25,000/month** — the point where the provider spread stops
   being noise and becomes ~$500/month.
2. F's bake-off shows another model within **2 points of required-document recall** at
   **≥50% lower cost**.
3. The ZDR route for the chosen provider changes, or Sonnet 5 gains a retention
   restriction.

Absent one of those, the model is not a topic. Cost work goes into the catalogue hit
rate instead, which is worth far more (§4).

## 4. Cost

> **Revised after Phase 0.** The generated catalogue turned out to be ~1,570 tokens,
> not the 6,000 estimated before it existed. That makes prompt caching a much
> smaller lever than first claimed, and moves image resolution into first place.
> Figures below replace the earlier ones.

Per analysis: one page image, ≈1,200 tokens of instructions, ≈900 output tokens, and
the ≈1,600-token catalogue. At 2200px the **image alone is 63% of the input** — so
resolution, not caching, is the dominant cost term.

Sonnet 5 at standard pricing, catalogue cached, per 1,000 documents:

| Image | Haiku 4.5 | **Sonnet 5** | Sonnet 5 (intro) | Opus 5 |
|---|---:|---:|---:|---:|
| 1600px — what the app's existing compression already produces | $8.27 | **$24.81** | $16.54 | $41.36 |
| 2200px — high fidelity | $10.64 | **$31.93** | $21.29 | $53.22 |

At ₪3.7/$, Sonnet 5 with the catalogue cached:

- **₪0.09–0.12** per analysed document, depending on resolution
- **₪1.1–1.5** per free-tier user per year at 10 documents/month
- **₪460–590** a year for an organisation running 5,000 documents

**What the levers are actually worth.** Caching the catalogue saves 19% of input
tokens, ~12% of total cost. Dropping the image from 2200px to 1600px saves 22% —
roughly twice as much. Caching is still worth doing (the catalogue clears Sonnet 5's
1,024-token cache minimum, and the 1.25× write amortises immediately), but the
question that decides the bill is **how small an image still reads a Hebrew letter
correctly**, and that is an eval question, not an architecture one. It is now an
explicit task in workstream F.

Against B2B/B2G pricing of ₪15–30k per organisation per year, inference is 2–4% of
revenue. The cost that threatens this feature is not tokens — it is an unmetered
free tier being scraped, which is why quota and a global daily spend cap are their
own workstream rather than a later hardening pass.

Two further levers: the **Batches API** halves the price of anything
non-interactive, which covers the whole form-map catalogue build; and the Haiku
pre-check kills selfies, blurry frames and receipts before they reach Sonnet.

### The catalogue hit rate is the only lever that matters

Once the identify pass exists, cost per document is
`$0.00827 + (1 − hit_rate) × $0.02481`:

| Catalogue hit rate | $/1,000 docs | vs reading every letter |
|---:|---:|---:|
| 0% | $33.08 | **+33%** |
| 20% | $28.12 | +13% |
| **33.3%** | **$24.82** | **break-even** |
| 50% | $20.67 | −17% |
| 70% | $15.71 | −37% |
| 85% | $11.99 | −52% |

**Below a 33.3% hit rate the identify pass costs more than it saves.** That is a
launch decision, not a footnote: ship layer 2 alone, measure the signature-collision
rate in shadow mode, and switch the catalogue on once it clears ~35%. Israeli
bureaucracy is concentrated enough — a handful of agencies sending standard form
letters — that 50–70% is plausible, but plausible is not measured.

This dwarfs every other lever in this document. Resolution is worth 22%; caching the
catalogue 12%; a mature checklist catalogue, 52%. And unlike the others it improves
on its own as the product is used.

## 5. Stack

| Piece | Choice | Reasoning |
|---|---|---|
| Edge service | Cloudflare Workers | No cold start, POPs near Israel, ~$5/mo floor, no server to patch. A compressed 1600px JPEG is ~300KB, well inside request limits |
| Document storage | **None** | The image streams through and is dropped. Nothing to breach, subpoena, or delete on request |
| Quota + metering | D1 (SQLite) | Device token, counters, spend. No document content, ever |
| Form-map catalogue | Static JSON, versioned in the repo | Public data, cacheable at the edge indefinitely, works offline once fetched |
| Model access | Anthropic first-party API, ZDR | Batches and prompt caching are first-party. ZDR agreed before any real document is sent |
| Abuse control | Anonymous device token + Turnstile on issue | No account, no email, no identity — keeps the free tier free of a sign-up wall |
| Checklist catalogue | D1, signature → document keys | Impersonal rows only. Promoted after agreement across sightings plus review |

## 6. Pricing

The layers give the pricing model for free, because they line up exactly with what
costs money.

**One credit = one letter that had to be read.** Templates and catalogue hits are
unmetered — they never reached the reading model, so there is nothing worth counting.
The client says which happened, and "we already knew this form, that one was free" is
a good thing for a user to see.

| Tier | Credits | Cost to run, at 70% hit rate | Note |
|---|---|---:|---|
| **Free** | 10/month | ₪7/user/year at full use | Most users will not use ten. Realistically ₪1–3 |
| **Personal** | 100/year, ₪39 one-off | ₪12/user | One-off, not a subscription — the product succeeds by becoming unnecessary, so renting it monthly is a bad fit and users know it |
| **Organisation** | Pooled, from 2,000/year | ₪230 per 2,000 | ₪15–30k/org/year as previously modelled; inference is ~1% of that |

Layer 0 and layer 1 stay free at any volume, including for users who never pay. That
is deliberate: a generous free tier is what feeds the catalogue, and the catalogue is
what makes the paid tiers cheap to serve. Metering the layer that costs nothing would
starve the only asset the product accumulates.

Two rules that keep this honest:

- **A failed read does not spend a credit.** Low confidence, unreadable photo,
  `not_a_letter` — the user gets nothing useful, so they pay nothing. The cost is
  absorbed; workstream G watches the rate, because a high one means the client is
  letting through images it should have rejected on device.
- **Credits never expire mid-process.** Someone in the middle of a תיק who runs out
  is exactly the person the product exists for.

---

## Phase 0 — blocking, one agent, no parallelism

Eight agents writing against an unwritten contract produce eight incompatible
guesses. Phase 0 exists so every later workstream codes against a file it can read.

| | Deliverable | State |
|---|---|---|
| 1 | `contracts/openapi.yaml` — `/v1/token`, `/v1/analyze`, `/v1/health`; shapes, status codes, one error envelope | **done** |
| 2 | `contracts/analysis.schema.json` — the structured-output schema | **done** |
| 3 | `contracts/formmap.schema.json` — the Track B field map | **done** |
| 4 | `tools/extract-catalogue.mjs` + `contracts/catalogue.json` | **done** — 9 agencies, 15 documents, 12 processes, ~1,570 tokens |
| 5 | `docs/privacy-decisions.md` | **done** |
| 6 | Feature flag and the offline contract, wired into the test suite | open |
| 7 | CI: `extract-catalogue.mjs --check`, schema validation, contract tests against a generated stub | open |

On (4): the generator exists precisely so there is one catalogue, not two.
Hand-copying `AGENCIES` / `DOCS` / `TEMPLATES` out of `index.html` creates a second
list that drifts the first time someone adds a document to one of them. `--check`
mode fails CI when the committed JSON no longer matches the app.

Deliberate omissions from the catalogue, both of which would otherwise cost accuracy:
the `other` agency key is dropped, because offering the model a bucket labelled
"other" gives every wrong answer somewhere to hide; and umbrella agencies carry their
`children` (the four health funds, the eleven banks) so the answer can be "Maccabi"
rather than "a health fund".

**Phase 0 closes when** a stub server generated from the OpenAPI file answers a
contract test in CI, and `--check` runs on every push.

## Phase 1 — eight parallel workstreams

Lettered, not numbered: they run in parallel and the ordering carries no meaning.

### A · Edge service and platform

- **Goal** — deployed Worker with routing, device tokens, quota, rate limiting, CORS
  allowlist, shared error envelope. Every AI endpoint stubbed, returning a
  well-formed `501`.
- **Owns** — `server/` router and middleware, `wrangler.toml`, D1 schema, deploy workflow.
- **Done when** — contract tests pass against the stubs; a token can be issued and
  driven to quota-exceeded; deploy runs from CI.
- **Must not touch** — `index.html`, prompts, the catalogue.

### B · Letter → checklist

- **Goal** — implement `/v1/analyze`: cheap pre-check, main call with the cached
  catalogue block, structured output, confidence thresholding, escalation path.
- **Implements an interface, not a vendor** — `analyze(image, catalogue, opts) ->
  AnalysisResult`, with one adapter per candidate provider behind it. Sonnet 5 is the
  default adapter; Gemini, GPT and a self-hosted Qwen3-VL adapter exist so F can
  score them on the same gold set without B rewriting anything.
- **Owns** — `server/analyze/`: the Hebrew system prompt, catalogue assembly,
  cache placement, retry and timeout policy, the adapters.
- **Reads** — `contracts/`, generated `catalogue.json`.
- **Done when** — workstream F's gold set clears the rollout thresholds. Not before:
  a passing unit test says nothing about whether the checklist is right.
- **Must not touch** — routing, auth, quota (A owns those), the client.

### C · Form field maps

- **Goal** — an offline builder that takes a blank official form (PDF or scan) and
  emits a versioned field map: field id, Hebrew label, type, which profile key
  answers it, page coordinates to print into.
- **Owns** — `tools/build-formmap.mjs` (Opus 5 via the Batches API),
  `catalogue/forms/*.json`.
- **Evaluate a dedicated OCR first.** Mistral OCR and Google Cloud Vision return
  bounding boxes and block types, which is precisely the page geometry this
  workstream otherwise asks a model to infer from an image. Cheaper and more exact
  for the coordinates; the model then only has to decide what each labelled box
  *means*. See `docs/MODEL-OPTIONS.md`.
- **Done when** — the first ten forms are mapped, each validated by filling it from a
  synthetic profile and having a Hebrew reader confirm every field landed in the
  right box.
- **Must not touch** — anything in `server/`; this never runs at request time.

### D · Client integration

- **Goal** — the opt-in surface inside `index.html`: consent screen, per-document
  "analyse this" action, a result the user reviews before anything is written, and a
  silent fall back to today's behaviour when the service is off or unreachable.
- **Owns** — the AI section of `index.html` and its tests.
- **Hard rule** — with AI disabled, **the existing 234 assertions must pass unchanged
  and the zero-third-party-request assertion must still hold.** That test is the
  feature's own regression guard.
- **Scope note** — the request was to add found documents to the checklist
  automatically. Built as specified — the items are added — but presented as a
  reviewable set with each item deselectable and a one-tap undo, because an item
  wrongly added to someone's ביטוח לאומי checklist sends them to the wrong counter.
- **Must not touch** — the storage layer, the existing case/document model, server code.

### E · Local profile and fill engine

- **Goal** — a local profile (name, ת״ז, address, dates, family), a fill engine that
  joins it to a downloaded field map, and on-device rendering to a printable,
  savable filled form.
- **Owns** — the profile model, the fill and render code, its tests.
- **Done when** — a test asserts that no outbound request anywhere in the app ever
  carries a profile value. The network-level version of the promise, not a code
  review of it.
- **Must not touch** — anything under `server/`. This code has no network access by design.

### F · Hebrew evaluation harness — start immediately, it gates everything

- **Goal** — 40+ real Israeli letters, de-identified, hand-labelled: ביטוח לאומי,
  רשות האוכלוסין, משרד העלייה והקליטה, רשות המסים, municipal ארנונה, health funds.
  Photographed the way users photograph — angled, creased, half in shadow.
- **Metrics** — required-document recall · false-add rate · agency accuracy ·
  deadline exactness · cost and latency per document.
- **Resolution curve** — run the whole gold set at 1200 / 1600 / 2200px and plot
  accuracy against cost. Image tokens are the largest single cost term (§4), so the
  cheapest resolution that holds the thresholds is worth more than any prompt
  tuning. Deliverable is a number, not an opinion.
- **Model bake-off** — run every adapter B implements over the same gold set:
  Sonnet 5, Haiku 4.5, Gemini 3 Flash / Flash-Lite, GPT-5 mini, and a split
  OCR→text pipeline. **F owns this decision.** No published benchmark measures
  Hebrew agency-letter understanding, so the gold set is the only evidence that
  will exist — see `docs/MODEL-OPTIONS.md`.
- **Rollout gate** — recall ≥ 0.90, false-add ≤ 0.05, agency ≥ 0.95, deadline exact
  ≥ 0.90. Below any of these the feature does not ship; it is a checklist people act on.
- **Must not touch** — prompts. The team that writes the prompt does not own the scoreboard.

### H · Checklist catalogue and promotion

- **Goal** — the layer-1 store: form signature → document keys, the promotion
  pipeline that decides when an on-the-fly checklist becomes a shared one, and the
  review queue that gates it.
- **Owns** — the signature function, the D1 catalogue table, the promotion rules, the
  review tool.
- **Promotion rules** — never on one sighting. Requires agreement across N
  independent devices, `personalised: false`, confidence above threshold on every
  contributing read, and a human pass before it serves anyone. One bad extraction
  promoted unchecked is a wrong checklist handed to everybody who gets that letter.
- **Hard rule** — **rows contain a signature hash and document keys. Nothing else.**
  No image, no name, no reference number, no dates, no extracted text, no device
  identifier. A schema that cannot hold personal data cannot leak it.
- **Done when** — shadow mode reports a measured signature hit rate and a
  false-collision rate (two genuinely different letters sharing a signature) near
  zero. The go/no-go for switching layer 1 on is a hit rate above ~35% (§4).
- **Must not touch** — the analyze path itself (B owns it), the client.

### G · Cost, observability, kill switch — before any public traffic

- **Goal** — per-device and global daily spend caps, token accounting per request,
  cache-hit-rate monitoring, and a degradation flag on `/v1/health` that the client
  honours by falling back to local-only mode.
- **Owns** — metering, logging, alerting, the kill switch.
- **Hard rule** — **no log line ever contains document content, an image, or a
  profile value.** Log the shape: token counts, latency, model, confidence, outcome.
- **Done when** — a load test drives the global cap and the client degrades cleanly
  rather than erroring.

## Phases 2–4

| Stage | Running | Exit condition |
|---|---|---|
| **2 — integration** | Everything together | Real client, real Worker, real model. Full 234-assertion suite green with AI off *and* with AI on |
| **3 — rollout, Hebrew only** | Shadow → 5% → GA | Shadow mode analyses and logs but adds nothing. Gated on F's thresholds holding on live traffic |
| **4 — other input languages** | French, Russian, English letters | The *output* already renders in all four; see §2 |

The dependency that constrains the schedule is F, not B. An evaluation set of real
Hebrew letters takes longer to assemble than a prompt takes to write, and nothing
ships until it exists — so it starts on day one alongside everything else.

---

## Open decisions

| Item | Why it blocks |
|---|---|
| **Zero-data-retention agreement** with Anthropic | Must be in place before a single real document is sent. It is also what removes Fable 5 from consideration, so the model choice depends on it |
| **Liability wording** | Today's disclaimer covers a hand-written starting checklist. A machine-generated one read off the user's own letter feels authoritative in a way the current wording does not account for |
| **Hosting region** | Cloudflare will run the worker wherever the request lands. If the answer needs to be "EU/Israel only", that is a config decision to take before launch, not after |
| **Free-tier quota** | Suggested: 10 documents per device per month — roughly ₪1.1–1.5/user/year, enough to be useful during the first weeks after arrival, which is when the funnel matters |

Moved to `docs/BACKLOG.md`, deferred by decision rather than forgotten:
**B-1** government symbols in the share image and the four-language disclaimer
(researched, wording drafted), **B-2** the MIT licence versus a paid service,
**B-3** the 2.4MB header video, **B-4** unverified gov.il slugs.

---

Prices are Anthropic first-party rates as of 24 June 2026. Shekel figures at ₪3.7/$.
