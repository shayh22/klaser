#!/usr/bin/env bash
# What is already on this Cloudflare account, in a form that is safe to paste.
#
#   npx wrangler login     # if not already
#   ./tools/cf-inventory.sh
#
# Prints no API tokens and no secret values. Account and database ids are shown
# truncated; they are identifiers rather than credentials, but there is no reason
# to spread them further than needed. Nothing here changes anything.
set -uo pipefail
cd "$(dirname "$0")/.."

W="npx --yes wrangler@latest"
NAME="$(grep -E '^name *=' wrangler.toml | head -1 | sed 's/.*"\(.*\)".*/\1/')"
DB="$(grep -E '^database_name *=' wrangler.toml | head -1 | sed 's/.*"\(.*\)".*/\1/')"

mask() { sed -E 's/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{8}([0-9a-f]{4})/…\1/g; s/\b[0-9a-f]{28}([0-9a-f]{4})\b/…\1/g'; }

echo "=== account ==="
$W whoami 2>&1 | mask | grep -vi 'token\|permission' || echo "(not logged in — run: npx wrangler login)"

echo
echo "=== does a Worker named '$NAME' already exist? ==="
if $W deployments list --name "$NAME" >/dev/null 2>&1; then
  echo "YES — deploying would REPLACE it. Pick another name in wrangler.toml."
else
  echo "no — the name is free."
fi

echo
echo "=== D1 databases ==="
$W d1 list 2>&1 | mask || true
echo
if $W d1 info "$DB" >/dev/null 2>&1; then
  echo "A database named '$DB' already exists."
else
  echo "No database named '$DB' yet — deploy.sh will create it."
fi

echo
echo "=== workers.dev subdomain ==="
echo "(the URL a new Worker gets by default: https://$NAME.<subdomain>.workers.dev)"
$W subdomain get 2>&1 | mask || echo "(could not read; the dashboard shows it under Workers & Pages)"

echo
echo "=== what is safe to share ==="
cat <<'NOTE'
Everything printed above is safe to paste.

Never paste, and never needed:
  - a Cloudflare API token or Global API Key
  - the contents of any `wrangler secret`
  - your ANTHROPIC_API_KEY
NOTE
