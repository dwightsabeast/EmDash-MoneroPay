#!/bin/sh
# Builds a development release of the wallet host (phase 03, sessions 3f-2 and 3g): xmr-bridge for linux/amd64 and
# linux/arm64 with the devrelease build tag (the dev public key and the loopback release address set at build time),
# an install.sh filled with their SHA-256s, and an unsigned release.json for Wyatt to sign
# (scripts/sign-dev-release.sh). Stagenet testing only; real releases (https, the real key) come from CI in phase 09.
#
#   scripts/build-dev-release.sh [--version <x.y.z[-suffix]>] [--break crash|badsig] [--base http://<address>:<port>]
#   serve:  tmux new -d -s release 'cd ~/xmr-pay-dev-data/dev-release && python3 -m http.server 8099 --bind 127.0.0.1'
#   --base: where the wallet host fetches the release (default loopback). Phase 05's setup test serves it on the dev
#   box's LAN address so a second machine can install; serve with --bind set to that address then.
#   install (Wyatt): curl -fsSL http://127.0.0.1:8099/install.sh | sh -s -- --site <site> --pair <code> --allow-same-machine
set -eu

repo=$(cd "$(dirname "$0")/.." && pwd)
out="$HOME/xmr-pay-dev-data/dev-release"
pubfile="$HOME/xmr-pay-dev-data/dev-release.pub"
base="http://127.0.0.1:8099"
version=""
breakmode=""
while [ $# -gt 0 ]; do
	case "$1" in
	--version) version=$2; shift 2 ;;
	--break) breakmode=$2; shift 2 ;;
	--base) base=$2; shift 2 ;;
	*) echo "usage: $0 [--version x.y.z] [--break crash|badsig] [--base http://<address>:<port>]" >&2; exit 2 ;;
	esac
done
case "$breakmode" in "" | crash | badsig) ;; *) echo "--break is crash or badsig" >&2; exit 2 ;; esac
# A scheme, a host and an optional port, nothing after: it's pasted into sed, install.sh and the bridge's build flags.
if ! printf '%s' "$base" | grep -Eq '^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$'; then echo "--base is http(s)://<address>[:<port>], no path or trailing slash" >&2; exit 2; fi
[ -f "$pubfile" ] || { echo "no $pubfile: Wyatt runs scripts/dev-release-key.sh first" >&2; exit 1; }
pub=$(tr -d '\n' <"$pubfile")
sha=$(git -C "$repo" rev-parse --short HEAD)
[ -n "$version" ] || version="0.0.$(date -u +%Y%m%d%H%M)-dev.$sha"
if ! git -C "$repo" diff --quiet -- bridge installer; then version="$version.dirty"; fi

rm -rf "$out"
mkdir -p "$out"
for arch in amd64 arm64; do
	(cd "$repo/bridge" && GOTOOLCHAIN=local CGO_ENABLED=0 GOOS=linux GOARCH=$arch go build -trimpath -tags devrelease \
		-ldflags "-X main.version=$version -X main.devReleaseKey=$pub -X main.devReleaseURL=$base -X main.devBreak=$breakmode" \
		-o "$out/xmr-bridge-$version-linux-$arch" ./cmd/xmr-bridge)
done
sum() { sha256sum "$1" | cut -d ' ' -f 1; }
size() { wc -c <"$1" | tr -d ' '; }
a="$out/xmr-bridge-$version-linux-amd64"
r="$out/xmr-bridge-$version-linux-arm64"
sed -e "s|__RELEASE_BASE__|$base|" -e "s|__VERSION__|$version|" -e "s|__SHA256_AMD64__|$(sum "$a")|" \
	-e "s|__SHA256_ARM64__|$(sum "$r")|" -e "s|__CURL_PROTO__|=http,https|" "$repo/installer/install.sh" >"$out/install.sh"
if grep -q '__[A-Z0-9_]*__' "$out/install.sh"; then echo "a placeholder was left in install.sh" >&2; exit 1; fi
printf '{"product":"xmr-bridge","version":"%s","date":"%s","files":[{"name":"%s","os":"linux","arch":"amd64","sha256":"%s","size":%s},{"name":"%s","os":"linux","arch":"arm64","sha256":"%s","size":%s}]}\n' \
	"$version" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(basename "$a")" "$(sum "$a")" "$(size "$a")" "$(basename "$r")" "$(sum "$r")" "$(size "$r")" >"$out/release.json"
(cd "$out" && sha256sum xmr-bridge-* install.sh release.json >SHA256SUMS)
echo "dev release $version${breakmode:+ (deliberately broken: $breakmode)} in $out; release.json is unsigned until Wyatt runs scripts/sign-dev-release.sh"
