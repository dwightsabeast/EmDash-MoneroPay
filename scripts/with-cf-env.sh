#!/usr/bin/env bash
# Runs wrangler with Wyatt's Cloudflare spike credentials in its environment:
#   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
# read from ~/.config/xmr-pay-dev/cloudflare.env (mode 600, written by Wyatt; spikes/cf-runner/SETUP.md).
#
# Usage: scripts/with-cf-env.sh <path to wrangler> [args...]
#
# Only wrangler runs under it: the token is for deploying the throwaway spike site (spikes/cf-runner/PLAN.md), and
# nothing here may print, log or echo it. Wyatt revokes the token when the spike ends.
set -euo pipefail

envfile="$HOME/.config/xmr-pay-dev/cloudflare.env"

if [ "$#" -eq 0 ]; then
  echo "usage: scripts/with-cf-env.sh <path to wrangler> [args...]" >&2
  exit 2
fi

if [ "$(basename -- "$1")" != "wrangler" ]; then
  echo "with-cf-env: runs only wrangler, not '$1'" >&2
  exit 2
fi
case "${2:-}" in
  secret|secrets-store|login|logout)
    echo "with-cf-env: refusing 'wrangler $2'" >&2
    exit 2 ;;
esac

if [ ! -f "$envfile" ]; then
  echo "with-cf-env: $envfile not found. Wyatt creates it (spikes/cf-runner/SETUP.md, step 4)." >&2
  exit 1
fi
if [ "$(stat -c %a "$envfile")" != "600" ]; then
  echo "with-cf-env: $envfile must be mode 600" >&2
  exit 1
fi

set +x
set -a
# shellcheck disable=SC1090
. "$envfile"
set +a

for v in CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID; do
  if [ -z "${!v:-}" ]; then
    echo "with-cf-env: $v is empty in $envfile" >&2
    exit 1
  fi
done

exec "$@"
