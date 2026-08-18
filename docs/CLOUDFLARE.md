# Deploying alongside an app you already run

Klaser deploys as one Worker serving both the page and the API. On an account that
already runs something, three things can collide, and one of them is destructive.

## The destructive one

`wrangler deploy` **replaces** a Worker of the same name without asking. The name in
`wrangler.toml` is `klaser`. If that name is already in use by your other app, a
deploy would overwrite it.

`tools/deploy.sh` now checks this first and stops rather than replacing anything it
did not create. It is the only step in the deployment that cannot be undone from the
script, so it happens before anything else.

## What I need from you

Run this and paste the output:

```bash
npx wrangler login          # if you are not already
./tools/cf-inventory.sh
```

It prints, and nothing else:

| | Why it matters |
|---|---|
| Account name, and id truncated | Which account we are deploying into — you may have more than one |
| Whether a Worker named `klaser` exists | The destructive collision above |
| Existing D1 databases | `klaser` must not clash with one of yours |
| Your `workers.dev` subdomain | It determines the URL: `https://klaser.<subdomain>.workers.dev` |

**Never paste, and never needed:** a Cloudflare API token or Global API Key, the
contents of any `wrangler secret`, or your `ANTHROPIC_API_KEY`. Nothing in the
deployment requires me to hold a credential — the script runs on your machine, under
your own `wrangler login`.

## Decisions that are yours

**Worker name.** `klaser` unless it collides. Change `name` in `wrangler.toml` and
everything follows.

**Where it lives.** The default is `https://klaser.<subdomain>.workers.dev`, which is
free and needs no DNS. If you would rather it sat on a domain you already have in
Cloudflare — `klaser.example.com`, or a path on the existing site — that is a route
configuration, and worth deciding before you share the link with anyone, because the
URL is the thing people keep.

**Plan.** The Workers free plan is enough for this: the analyse endpoint is mostly
waiting on Anthropic rather than burning CPU, and it makes two or three subrequests
against a limit of fifty. D1's free tier covers a credit counter comfortably. Your
existing app's usage and Klaser's share the same account limits, which is the only
reason the plan is worth a glance.

## Isolation from your existing app

The two share an account and nothing else. Separate Worker, separate D1 database,
separate secrets — a `wrangler secret` belongs to one Worker, so Klaser's Anthropic
key is not visible to your other app and vice versa. The only shared surface is the
account-level request and storage quota.
