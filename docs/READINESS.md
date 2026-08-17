# Readiness review — cloud and AI build

**17 August 2026 · companion to `CLOUD-AI-PLAN.md`**

## Verdict: ready to start, not ready to build

The thinking is done and the contracts exist. What is missing is not design — it is
two CI tasks, a signed agreement, and **forty real Hebrew letters that only you can
obtain**. That last one is the critical path, it has a long lead time, and no amount
of engineering shortens it.

Nothing here argues for delay. It argues for starting the letter collection today, in
parallel with everything else, because every other lane can be built while it happens
and none of them can ship before it lands.

## Where each piece stands

| Piece | State | Note |
|---|---|---|
| The app itself | **Shipped** | Live on Pages, 234 assertions green |
| Phase 0 contracts | **5 of 7** | Feature flag and CI outstanding |
| A · Edge service | Not started | No code exists yet |
| B · Letter → checklist | Not started | Contract ready to code against |
| C · Form field maps | Not started | Zero forms mapped |
| D · Client integration | Not started | Riskiest lane — touches shipped code |
| E · Profile and fill | Not started | RTL PDF rendering is fiddly |
| F · Hebrew eval set | **Blocked on you** | Zero letters collected. Gates everything |
| G · Cost and kill switch | Not started | Must land before public traffic |
| H · Checklist catalogue | Not started | Cold-start problem, see R3 |
| ZDR agreement | Not signed | Blocks the first real document |
| Legal position (B-1) | Deferred | Researched, decision pending |

## Decisions made

Each says what would reverse it, so none is quietly permanent.

| Decision | Why | What would reverse it |
|---|---|---|
| **Split trust: letters go up, profile never does** | Form filling needs to know what the blank form asks, not the answers — so it needs no server at request time | Nothing. This is the design |
| **The model returns catalogue keys, not prose** | Makes hallucinated document names structurally impossible, makes the result exactly evaluable, gives all four languages free | A catalogue too small to describe real letters — watch the `extra_docs` rate |
| **Sonnet 5 reads, Haiku 4.5 identifies, Opus 5 escalates** | Shortest ZDR route; the whole provider spread at launch volume is ~$110/month, so Hebrew accuracy decides, not price | Volume past 25k/month · a model within 2 points of recall at half the cost · a change in the retention position |
| **Three answer layers; one credit = one letter read** | Custom forms are the expensive path. Templates and catalogue hits cost nothing, so they are not metered | A measured hit rate that stays below 33% — then layer 1 costs more than it saves |
| **Opt-in per document, no retention, no account** | The strongest thing the product says about itself is that nothing is uploaded. The weakening has to be small and chosen | Nothing. Reversing this reverses the product |
| **Results are proposals, reviewed before adding** | Automatic as requested, but each item carries the Hebrew phrase it came from and is deselectable | Measured false-add rate near zero over real traffic |
| **Cloudflare Workers, no document storage, D1 for quota** | Nothing stored means nothing to breach, subpoena, or delete on request | A hosting-region requirement Workers cannot satisfy |
| **AI off must be byte-identical to today** | The 234 assertions, including zero third-party requests, are the feature's own regression guard | Nothing |

## Open issues

Split by who can close them. That distinction matters more than the list.

### Only you can close these

| Item | Blocks |
|---|---|
| **Collect 40+ real Hebrew agency letters**, de-identified — ביטוח לאומי, רשות האוכלוסין, משרד העלייה והקליטה, רשות המסים, municipal ארנונה, health funds. Photographed the way users photograph: angled, creased, half in shadow | **Everything.** Nothing ships un-evaluated |
| Sign the zero-data-retention agreement with Anthropic | The first real document |
| Provide an API billing account and a Cloudflare account | Workstreams A and B |
| Decide liability wording, ideally after an hour with an Israeli lawyer | Public rollout, not development |
| Confirm free-tier quota (10/month suggested) and the ₪39 personal price | Workstream G |
| Hosting region — is "EU or Israel only" a requirement? | Workstream A config |
| Resolve backlog B-1, the state emblem in the share image | Nothing technical. Gets sharper at launch — see R8 |

### I can close these

| Item | Blocks |
|---|---|
| Finish Phase 0: feature flag wired into the test suite, CI running `--check`, schema validation and contract tests | Opening the eight lanes |
| Seed the catalogue by hand with the 20 most common letters before launch | Nothing, but see R3 |
| Verify six `gov.il` department slugs (B-4) — needs unblocked network | Nothing |

## Risks

Ranked by what would actually hurt, not by likelihood alone.

### R1 · The evaluation set does not exist, and I cannot create it — **critical**

Every threshold in the plan — recall ≥ 0.90, false-add ≤ 0.05 — is measured against
forty real letters nobody has collected. I can write every line of the pipeline; I
cannot obtain Israeli agency correspondence. Longest lead item, on the critical path
from day one.

*Mitigation:* start today, in parallel. Forty is the floor, not the target. Olim
Facebook groups and ulpan cohorts are the obvious source, and people are usually glad
to help if the de-identification is done for them.

### R2 · A wrong checklist has real consequences — **high**

A missed deadline loses a benefit. A wrong document list costs a day off work and a
wasted trip. Today's disclaimer covers a hand-authored starting list; a
machine-generated one read off the user's own letter carries an authority the current
wording does not account for.

*Mitigation:* evidence strings on every suggestion, review before adding, hard
rollout thresholds, updated wording. Residual risk stays above zero — this is the
feature's inherent hazard, not a bug to close.

### R3 · The catalogue makes economics worse before better — **medium**

Hit rate is 0% on launch day, where the two-tier design costs **33% more** than simply
reading every letter. It only improves with volume, which is what a new product does
not have. Left alone, a flywheel that never starts turning.

*Mitigation:* ship layer 2 alone, switch layer 1 on above a measured 35% — already the
plan. Better: seed the catalogue by hand with the twenty most common letters before
launch, so day one starts non-zero. Turns a cold-start problem into a content task.

### R4 · Signatures break in batches when an agency redesigns — **medium**

One layout change at ביטוח לאומי invalidates every signature for that letter at once.
Hit rate craters, costs jump, nothing looks obviously broken.

*Mitigation:* it degrades to correct-but-expensive rather than wrong — a miss falls
through to a full read by design. G alerts on hit-rate drop; signatures carry a
revision field.

### R5 · The privacy promise regresses through an unrelated change — **high**

Everything the product claims rests on one assertion: no third-party requests. A
future change adding an analytics snippet or a font CDN breaks the strongest claim
Klaser makes, quietly, in a commit about something else.

*Mitigation:* the zero-third-party assertion runs against the AI-disabled build on
every push and is a merge blocker, not a warning. It exists; it must not become
advisory.

### R6 · Free-tier scraping — **medium**

An anonymous image endpoint is a target. Turnstile at token issue is one gate, and
gates get solved.

*Mitigation:* G's global daily spend cap and kill switch land before any public
traffic — already a hard rule, and this is the reason for it.

### R7 · The plan's numbers have already been wrong twice — **medium**

The catalogue was estimated at 6,000 tokens and came in at 1,570, which inverted the
claim that caching was the main cost lever. Resolution then displaced caching as the
real lever. Both corrections came from measurement, not review — which is the point,
but it means every remaining figure is an estimate wearing a decimal point.

*Mitigation:* shadow mode before general availability; F reports actuals against every
projection. Treat the cost tables as hypotheses.

### R8 · Looking official gets more dangerous, not less — **medium**

Backlog B-1 turns on one question: would a viewer think you act מטעם המדינה. A
checklist app is plainly a helper. A service that reads your government letters and
tells you what the state wants from you sits much closer to that line — and does so
precisely as marketing reach grows.

*Mitigation:* take B-1 off the backlog before public launch rather than after. The
four-language wording is already drafted.

### R9 · Scope against a product that already works — **watch**

Eight workstreams, a service that does not exist, a form-mapping pipeline and an eval
harness — months, not weeks. Meanwhile Klaser is live, useful and green. The failure
mode is destabilising something that works in pursuit of something that might.

*Mitigation:* the AI-off-is-identical rule, enforced by the existing suite, is what
keeps the working product safe while the rest is built.

## Critical path

Everything not listed can run in parallel with all of it.

1. **You start collecting letters** — today, before anything else, longest lead time,
   gates every ship decision.
2. **I close Phase 0** — feature flag plus CI. Two tasks. Opens the eight lanes.
3. **You sign ZDR and provide accounts.** Development proceeds without this; sending
   one real document does not.
4. **Lanes A–H run in parallel.** F reports numbers as letters arrive, even while B is
   still moving.
5. **Shadow mode** — analyse, log, add nothing. Where the projections meet reality:
   hit rate, resolution curve, false-add rate.
6. **Resolve B-1, then 5% of devices, then general availability**, gated on F's
   thresholds holding on live traffic.

**Timing:** with lanes in parallel, realistically six to ten weeks of concentrated
work, dominated by letter collection and by how fiddly C and E turn out — RTL PDF
rendering and Israeli boxed-digit form fields are both worse than they look. That
assumes the letters arrive early. If they arrive in week six, add six weeks.
