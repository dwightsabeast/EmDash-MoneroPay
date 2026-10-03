#!/usr/bin/env bash
# Runs one command with the stagenet shop wallet's details in its environment:
#   SHOP_ADDRESS, SHOP_VIEW_KEY, SHOP_RESTORE_HEIGHT
# read from ~/.config/xmr-pay-dev/stagenet.env (mode 600, written by Wyatt).
#
# Usage: scripts/with-shop-env.sh <command> [args...]
#
# Rules for whatever runs under this wrapper (see CLAUDE.md):
#   - never print, log or echo SHOP_VIEW_KEY;
#   - pass it to wallet-rpc on stdin or in a request body, never as a command-line argument;
#   - stagenet only.
# This file is reviewed by Wyatt and protected from edits in .claude/settings.json.
set -euo pipefail

envfile="$HOME/.config/xmr-pay-dev/stagenet.env"

if [ "$#" -eq 0 ]; then
  echo "usage: scripts/with-shop-env.sh <command> [args...]" >&2
  exit 2
fi

case "$(basename -- "$1")" in
  env|printenv|set|export|declare|echo|printf|cat|less|more|head|tail|tee|xxd|od|strings|bash|sh|zsh|dash)
    echo "with-shop-env: refusing to run '$1' (it could reveal the view key)" >&2
    exit 2 ;;
esac

if [ ! -f "$envfile" ]; then
  echo "with-shop-env: $envfile not found. Wyatt creates it (START-HERE.md, step 3)." >&2
  exit 1
fi
if [ "$(stat -c %a "$envfile")" != "600" ]; then
  echo "with-shop-env: $envfile must be mode 600" >&2
  exit 1
fi

set +x
set -a
# shellcheck disable=SC1090
. "$envfile"
set +a

for v in SHOP_ADDRESS SHOP_VIEW_KEY SHOP_RESTORE_HEIGHT; do
  if [ -z "${!v:-}" ]; then
    echo "with-shop-env: $v is empty in $envfile" >&2
    exit 1
  fi
done

# Stagenet primary addresses start with 5; mainnet with 4. Refuse anything but stagenet.
case "$SHOP_ADDRESS" in
  5*) ;;
  *) echo "with-shop-env: SHOP_ADDRESS is not a stagenet primary address" >&2; exit 1 ;;
esac

exec "$@"
