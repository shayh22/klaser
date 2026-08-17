# Roadmap — phases and priorities

**17 August 2026.** Supersedes the phase numbering inside `CLOUD-AI-PLAN.md`; that
document keeps the architecture, this one keeps the order.

## What changed

You can obtain the official document list for each generic form directly from the
authorities. That is a bigger deal than it sounds, and it reorders everything.

The plan assumed checklists for unknown processes had to be *derived* — read off a
user's letter by a model, then promoted into a shared catalogue once several people
had sent the same one. Official lists remove that whole chain for the common cases:

- **Better source.** The agency's own list beats anything inferred from a letter.
- **No privacy question.** Public reference data, not something derived from a user's
  document.
- **No cold start.** Risk R3 was that the catalogue is empty on launch day, where the
  two-tier design costs 33% *more* than reading every letter. Hand-authored content
  starts it full.
- **No AI dependency.** It ships into the static app as it stands today.
- **It makes the AI better when it arrives.** The model answers with catalogue keys,
  so a bigger catalogue means fewer unmatched documents and less guessing. It also
  gives a validation surface: when the model's list for a known form disagrees with
  the official one, that disagreement is a signal worth showing.

**The headline: none of the blocked items block Phase 1.** ZDR, the eval letters, the
billing accounts, the legal question — all of them gate the AI service. None of them
gate expanding the app's content, which is where most of the near-term value is.

---

## P0 — value with no new infrastructure

### Phase 1 · Template expansion  🔴 highest priority

Take `TEMPLATES` from 12 processes to 40–60, sourced from the authorities.

Nothing else in this document delivers as much per unit of effort. No server, no
model, no cost per use, no consent screen, works offline, and every process added
helps somebody this month rather than after a six-week build.

Each entry gains provenance, which the current twelve do not have:

```js
child_allowance:{
  agency:'btl',
  docs:['teudat_zehut','sefach','bank_confirm','claim_form'],
  source:'https://www.btl.gov.il/…',   // where the list came from
  checked:'2026-08-17',                // when someone last looked
  he:'קצבת ילדים', fr:'…', en:'…', ru:'…'
}
```

`checked` matters because requirements change and a stale list read as current is
worse than no list. The app can surface age on entries older than a year, and the
existing disclaimer stays true regardless: these are starting points, requirements
differ by circumstance.

**What I need from you, per process:** official Hebrew name · agency · the document
list · the official URL · form number if the process has one. gov.il is blocked from
this environment, so I cannot fetch the pages myself — paste the text, or send
screenshots, and I will do the rest including the four translations, the
transliterations and any new `DOCS` entries.

A suggested first batch, grouped so you can gather them per visit:

| Agency | Processes |
|---|---|
| ביטוח לאומי | דמי לידה · אבטחת הכנסה · קצבת נכות · קצבת זקנה · דמי מזונות · תאונת עבודה |
| רשות המסים | תיאום מס · נקודות זיכוי לעולה · מענק עבודה · פתיחת תיק עוסק · טופס 101 · מס רכישה לעולה |
| רשות האוכלוסין | שינוי כתובת · רישום לידה · רישום נישואין · חידוש דרכון · אשרה לבן/בת זוג |
| משרד החינוך | רישום לגן · רישום לבית ספר · הנחה בצהרון |
| משרד התחבורה | העברת בעלות רכב · טסט שנתי · רישיון נהיגה ראשון |
| קופות חולים | מעבר בין קופות · אישור זכאות · ועדה רפואית |

**Done when** the batch is in `index.html`, the catalogue regenerates cleanly, and the
234 assertions still pass. Ships the same day it lands.

### Phase 2 · Close Phase 0  🔴 highest priority

Mine, small, unblocks everything downstream: the feature flag wired into the test
suite, and CI running `extract-catalogue.mjs --check`, schema validation, and contract
tests against a generated stub. Two tasks.

### Phase 3 · Letter collection  🔴 highest priority, long running

Starts now and runs behind everything else. 40+ real Hebrew agency letters,
de-identified, photographed the way users photograph. This is the longest-lead item on
the whole roadmap and nothing in P1 ships without it.

Note that Phase 1 makes this *easier*: with a richer catalogue, labelling a letter is
mostly picking existing keys rather than inventing new ones.

**Gate into P1:** Phase 2 complete, and at least 20 letters collected.

---

## P1 — the read service

The originally requested feature. Everything here depends on the ZDR agreement and the
billing accounts.

### Phase 4 · Service skeleton  🟠 high

Workstreams **A** and **G** together — routing, device tokens, quota in credits, rate
limiting, spend caps, kill switch, deploy from CI. Every AI endpoint stubbed at `501`.

Deliberately paired: G was scheduled late in the original plan, but a spend cap that
arrives after the endpoint does is a spend cap that arrives after the bill.

### Phase 5 · Read pipeline and evaluation  🟠 high

Workstreams **B** and **F**, iterating against each other. B implements
`analyze()` behind the adapter interface; F scores it on the gold set and publishes
recall, false-add rate, agency accuracy, deadline exactness, the resolution curve, and
the model bake-off.

**Gate:** recall ≥ 0.90 · false-add ≤ 0.05 · agency ≥ 0.95 · deadline exact ≥ 0.90.

### Phase 6 · Client integration and rollout  🟠 high

Workstream **D**, then shadow mode → 5% → general availability. Resolve backlog **B-1**
before public launch, not after — see risk R8.

**Gate into P2:** thresholds holding on live traffic for two weeks.

---

## P2 — form filling

Genuinely valuable and genuinely the fiddliest work in the plan. It is also fully
independent of P1, so it can start earlier if there is capacity — it is P2 by
sequencing preference, not by dependency.

### Phase 7 · Form field maps  🟡 medium

Workstream **C**. Official form PDFs, one field map each. Evaluate a dedicated OCR
first: bounding boxes are exactly the geometry this otherwise asks a model to infer.

Your official-forms access helps here too — the authoritative blank PDF, and the
official document list for the same process, both come from the same page.

### Phase 8 · Profile and fill engine  🟡 medium

Workstream **E**. The local profile, the fill engine, on-device rendering. RTL text and
Israeli boxed-digit fields are both harder than they look; budget accordingly.

---

## P3 — scale

### Phase 9 · Derived catalogue  🟢 low, revisit at volume

Workstream **H** — the flywheel that promotes on-the-fly checklists into shared ones.

**Demoted deliberately.** Phase 1 does the same job better for every common process,
from a better source, with no privacy surface. H is only worth building for the long
tail: municipal letters, departmental one-offs, processes too rare to hand-author. And
it only pays above a measured 33% hit rate, which needs volume that will not exist
until well after P1.

### Phase 10 · Other input languages  🟢 low

Accept French, Russian and English letters. The *output* already renders in all four —
the model returns keys, and the client translates them. This is a smaller phase than
it sounds.

---

## Priority summary

| Phase | What | Priority | Blocked by |
|---|---|---|---|
| 1 | Template expansion from official lists | 🔴 | Nothing — your document lists |
| 2 | Close Phase 0 (flag + CI) | 🔴 | Nothing |
| 3 | Letter collection | 🔴 | Nothing — starts now, runs long |
| 4 | Service skeleton (A + G) | 🟠 | ZDR, accounts, Phase 2 |
| 5 | Read pipeline + eval (B + F) | 🟠 | Phase 3, Phase 4 |
| 6 | Client + rollout (D), resolve B-1 | 🟠 | Phase 5 gate |
| 7 | Form field maps (C) | 🟡 | Nothing technical |
| 8 | Profile + fill engine (E) | 🟡 | Phase 7 |
| 9 | Derived catalogue (H) | 🟢 | Volume from Phase 6 |
| 10 | Other input languages | 🟢 | Phase 6 |

**Start today:** Phase 1 needs your document lists, Phase 3 needs your letters, and
Phase 2 needs neither. Those three run in parallel and none of them waits on a signed
agreement or a billing account.
