# Getting an Anthropic API key

## Where

**console.anthropic.com** — a separate account from claude.ai. A Claude Pro or Max
subscription does **not** include API access; the API is billed separately, by usage.

1. Sign up or sign in at <https://console.anthropic.com>
2. **Billing → Add credits.** The API is prepaid; the minimum is around $5. That is
   plenty — see the costs below.
3. **Billing → Limits → set a monthly spend limit.** Do this before creating the key,
   not after. $10 is a sensible ceiling for testing.
4. **API keys → Create Key.** Name it something you will recognise later, e.g.
   `klaser-dev`. **The key is shown once.** Copy it then; there is no way to see it
   again, only to revoke and create another.

The key looks like `sk-ant-api03-…`.

## What testing actually costs

About **$0.03 per letter** on Sonnet 5 — roughly ₪0.11. Concretely:

| | |
|---|---|
| One probe run | ~$0.03 |
| Fifty letters while tuning the prompt | ~$1.50 |
| The full 40-letter evaluation set, ten times over | ~$12 |

$5 of credit covers the whole bring-up with room to spare. The Worker also carries a
daily spend cap (`DAILY_SPEND_CAP_USD`, default $25) so a bug cannot run up a bill.

## First run — one command

```bash
cd klaser
ANTHROPIC_API_KEY=sk-ant-… node tools/probe-live.mjs
```

That makes one real call through the exact code path the app uses, on the test image
in `tests/`, and prints what came back — model, tokens, cost, latency, the parsed
result, and a sanity check that every document is a real catalogue key.

To try a real letter instead:

```bash
ANTHROPIC_API_KEY=sk-ant-… node tools/probe-live.mjs ~/Desktop/letter.jpg
```

If the API rejects the request, the probe prints the upstream response verbatim —
which field it objected to and why. That output is what makes the failure fixable.
The key itself is never printed (only its last four characters), and no part of the
image is printed.

## About sharing the key

If you want the bring-up done for you, the safe pattern is not to hand over a key at
all — run the probe yourself and paste the output. It contains no secret, and it
carries everything needed to diagnose a failure.

If you do decide to share one:

- **Create a key used for nothing else**, with a low spend limit.
- **Revoke it when the work is done** — console.anthropic.com → API keys → Revoke.
  Revoking is instant and cannot be undone, which is the point.
- Remember that anything pasted into a chat stays in that transcript, and this
  container is rebuilt from the repository each session — a key left in a file here
  does not survive, but a key in a message does.

Never commit a key. `wrangler secret put ANTHROPIC_API_KEY` is how it reaches
production; it is never written to `wrangler.toml`.

## Then what

`docs/GO-LIVE.md` picks up from here: zero-data-retention, deploying the Worker, and
the one step that cannot be rushed — the evaluation set.
