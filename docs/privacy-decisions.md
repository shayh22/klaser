# Privacy decisions

Phase 0 deliverable. These are settled, not proposals — a workstream that needs to
depart from one raises it here first rather than in a pull request.

## The starting position

Klaser today makes an unusually strong claim, and a test enforces it: no network
requests at all. Adding a cloud feature weakens that claim no matter how it is
built. The decisions below exist to make the weakening **small, visible, and
entirely the user's choice**, rather than a footnote in a policy nobody reads.

## What is sent, ever

| | Sent | Never sent |
|---|---|---|
| **Track A — reading a letter** | One page image, one document at a time, after an explicit tap | Anything else in the app |
| **Track B — filling a form** | *Nothing* | Name, ת״ז, address, dates, family, case numbers, scans |

Track B has no request path. There is no endpoint that accepts profile data, so
there is nothing to misconfigure.

## Retention

**None.** The image lives in worker memory for the duration of the request. It is
not written to disk, a bucket, a queue, a cache, or a log. There is no endpoint to
read a document back because there is nowhere to read it from.

Model access runs under a zero-data-retention agreement with Anthropic. This is what
removes `claude-fable-5` from consideration — it requires 30-day retention and
therefore cannot be used at all, at any price.

## Consent

- **Per document, not per session and not per install.** The consent record carries
  `scope: "single_document"`, the server rejects any other scope, and a client bug
  cannot promote a one-off into a standing permission.
- The first use shows what is sent, where it goes, that nothing is kept, and that
  declining costs the user nothing.
- Declining is not remembered as a refusal to be re-asked later. The user is not
  nagged.
- Consent text ships in all four languages before the feature is enabled for anyone,
  not as a follow-up.

## What happens when the user says no

Nothing changes. That is the entire answer, and it is a hard requirement rather than
a courtesy:

- With the feature off, unreachable, degraded, or declined, Klaser behaves **exactly
  as it does today**.
- The existing 234 assertions run against the AI-disabled build unchanged, including
  the zero-third-party-request assertion. That test is the feature's own regression
  guard: if someone makes a network call on the default path, it fails.

## What is logged

Request shape only: token counts, latency, model, confidence, outcome code, quota
state. The `AnalysisMeta` object in the OpenAPI contract is exactly the log record —
the same shape is returned to the client and written to the log, so there is no
second, richer log to audit separately.

Never logged: image bytes, extracted text, reference numbers, the Hebrew evidence
strings, profile values, IP addresses beyond what the edge needs for rate limiting.

## Identity

No account, no email, no phone number. An anonymous device token bound to nothing
but its own quota counter. Turnstile gates token issuance so the free tier cannot be
farmed — one call per device, not per document, and it is the only third-party
request in the design.

## The results are proposals

The model's output is shown, with the Hebrew phrase each suggestion was drawn from,
before anything is written to a case. Items can be deselected individually and the
whole set undone in one tap.

The original request was for documents to be added automatically, and they are —
this is about what "added" looks like, not about withholding the feature. An item
wrongly added to someone's ביטוח לאומי checklist sends them to the wrong counter
with the wrong papers, and the evidence string is what lets them catch it in two
seconds.

## Jurisdiction and open items

Hosting region and the signed ZDR agreement are open — see `docs/CLOUD-AI-PLAN.md`.
Neither blocks Phase 1 work, both block sending a single real document.
