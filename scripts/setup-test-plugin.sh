#!/bin/sh
# Builds the plugin for phase 05's setup test: a normal build, then the install-command placeholder in the built
# sandbox entry (dist/plugin.mjs) swapped for the dev release's address, so the admin page shows a command the tester
# can paste as is. The source keeps the placeholder, and release builds come from a clean checkout in CI, so this
# never reaches a release. A plain `pnpm run build` puts the placeholder back.
#
#   scripts/setup-test-plugin.sh --base http://<dev box LAN address>:8099
#   (the same --base as scripts/build-dev-release.sh)
set -eu
repo=$(cd "$(dirname "$0")/.." && pwd)
placeholder="https://REPLACE-RELEASE-HOST.invalid/install.sh"
base=""
while [ $# -gt 0 ]; do
	case "$1" in
	--base) base=$2; shift 2 ;;
	*) echo "usage: $0 --base http://<address>:<port>" >&2; exit 2 ;;
	esac
done
if ! printf '%s' "$base" | grep -Eq '^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$'; then echo "--base is http(s)://<address>[:<port>], no path or trailing slash" >&2; exit 2; fi
grep -qF "export const INSTALL_URL = \"$placeholder\";" "$repo/plugin/src/admin.ts" || { echo "the placeholder in plugin/src/admin.ts changed; update this script" >&2; exit 1; }

cd "$repo/plugin"
pnpm run build >/dev/null
# The bundle check rebuilds dist, so it runs before the swap, never after.
pnpm exec emdash-plugin bundle --validate-only >/dev/null
entry="$repo/plugin/dist/plugin.mjs"
n=$(grep -cF "$placeholder" "$entry" || true)
[ "$n" = 1 ] || { echo "expected the placeholder once in dist/plugin.mjs, found $n" >&2; exit 1; }
tmp="$entry.tmp.$$"
# The address passed the check above (no | & \ or spaces), so it's safe as a sed replacement.
sed "s|$placeholder|$base/install.sh|" "$entry" >"$tmp"
mv "$tmp" "$entry"
# The bundler inlines the constant into the command's template string.
grep -qF "curl -fsSL $base/install.sh | sh -s -- --site" "$entry" || { echo "the install URL didn't land in the install command in dist/plugin.mjs" >&2; exit 1; }
! grep -qF "$placeholder" "$entry" || { echo "the placeholder is still in dist/plugin.mjs" >&2; exit 1; }
echo "plugin built for the setup test: the admin page's install command fetches $base/install.sh"
echo "a plain 'pnpm run build' restores the placeholder"
