#!/usr/bin/env bash
# Deploy Klaser to Cloudflare: the app and the API, one Worker, one origin.
#
#   wrangler login          # once, opens a browser
#   ./tools/deploy.sh       # everything else
#
# Safe to run repeatedly. It creates what is missing and leaves what exists alone.
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

have npx || { echo "Node and npx are required."; exit 1; }
WRANGLER="npx --yes wrangler@latest"

say "1/6  Who are we deploying as?"
$WRANGLER whoami || { echo "Not logged in. Run: npx wrangler login"; exit 1; }

say "2/7  Is this name already taken?"
NAME="$(grep -E '^name *=' wrangler.toml | head -1 | sed 's/.*"\(.*\)".*/\1/')"
# `wrangler deploy` replaces a Worker of the same name without asking. On an
# account that already runs something else, that is the one mistake here that
# cannot be undone from this script, so it is checked before anything happens.
if $WRANGLER deployments list --name "$NAME" >/dev/null 2>&1; then
  echo "A Worker named '$NAME' already exists on this account."
  echo "Deploying would REPLACE it."
  echo
  read -r -p "Is '$NAME' the Klaser worker, and should it be replaced? [y/N] " reply
  case "$reply" in
    [yY]*) echo "Continuing." ;;
    *) echo "Stopping. Change 'name' in wrangler.toml and run again."; exit 1 ;;
  esac
else
  echo "'$NAME' is free."
fi

say "3/7  Checking the catalogue is in step with the app"
node tools/extract-catalogue.mjs --check

say "4/7  Database"
if grep -q 'database_id = "REPLACE_ME"' wrangler.toml; then
  echo "Creating D1 database 'klaser'…"
  OUT="$($WRANGLER d1 create klaser 2>&1 || true)"
  echo "$OUT"
  # the id is printed as database_id = "…" in the snippet wrangler suggests
  ID="$(printf '%s' "$OUT" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)"
  if [ -z "$ID" ]; then
    echo
    echo "Could not read the database id from that output."
    echo "Copy it into wrangler.toml (replace REPLACE_ME) and run this again."
    exit 1
  fi
  # keep a backup: this edits a tracked file
  cp wrangler.toml wrangler.toml.bak
  sed -i.tmp "s/database_id = \"REPLACE_ME\"/database_id = \"$ID\"/" wrangler.toml && rm -f wrangler.toml.tmp
  echo "database_id set to $ID (previous file kept as wrangler.toml.bak)"
else
  echo "database_id already set — leaving it alone."
fi

say "5/7  Schema"
$WRANGLER d1 migrations apply klaser --remote

say "6/7  Secrets"
if $WRANGLER secret list 2>/dev/null | grep -q ANTHROPIC_API_KEY; then
  echo "ANTHROPIC_API_KEY is already set."
else
  echo "ANTHROPIC_API_KEY is not set."
  echo "Without it the service answers from the mock — useful for a first deploy,"
  echo "but not real analysis. Set it with:"
  echo "    npx wrangler secret put ANTHROPIC_API_KEY"
fi

say "7/7  Deploy"
$WRANGLER deploy

cat <<'DONE'

Deployed. Two things worth doing now:

  1. Open the printed URL on your phone. The scan button should be there with no
     configuration — the Worker tells the page where the API is.

  2. Check which provider answered:
         curl https://<your-worker-url>/v1/health
     "provider":"mock" means the key is not set yet; "anthropic" means it is real.

The kill switch, if anything runs away:
    npx wrangler secret put KILL_SWITCH   # enter 1
DONE
