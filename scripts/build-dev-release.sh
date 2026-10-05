#!/bin/sh
# Builds a development release of the wallet host for testing install.sh before real releases exist (phase 03,
# session 3f-2): xmr-bridge for linux/amd64 and linux/arm64, and an install.sh filled in with their SHA-256s and a
# loopback release address. Stagenet testing only; real releases (signed, https only) come from CI in phase 09.
#
#   scripts/build-dev-release.sh            # writes ~/xmr-pay-dev-data/dev-release/
#   then serve it on loopback:  tmux new -d -s release 'cd ~/xmr-pay-dev-data/dev-release && python3 -m http.server 8099 --bind 127.0.0.1'
#   and install:                curl -fsSL http://127.0.0.1:8099/install.sh | sh -s -- --site <site> --pair <code> --allow-same-machine
set -eu

repo=$(cd "$(dirname "$0")/.." && pwd)
out="$HOME/xmr-pay-dev-data/dev-release"
base="http://127.0.0.1:8099"
version="0.0.0-dev.$(git -C "$repo" rev-parse --short HEAD)"
if ! git -C "$repo" diff --quiet -- bridge installer; then
	version="$version.dirty"
fi

rm -rf "$out"
mkdir -p "$out"
for arch in amd64 arm64; do
	(cd "$repo/bridge" && GOTOOLCHAIN=local CGO_ENABLED=0 GOOS=linux GOARCH=$arch \
		go build -trimpath -ldflags "-X main.version=$version" -o "$out/xmr-bridge-$version-linux-$arch" ./cmd/xmr-bridge)
done
sum() { sha256sum "$1" | cut -d ' ' -f 1; }
sed -e "s|__RELEASE_BASE__|$base|" -e "s|__VERSION__|$version|" \
	-e "s|__SHA256_AMD64__|$(sum "$out/xmr-bridge-$version-linux-amd64")|" \
	-e "s|__SHA256_ARM64__|$(sum "$out/xmr-bridge-$version-linux-arm64")|" \
	-e "s|__CURL_PROTO__|=http,https|" \
	"$repo/installer/install.sh" > "$out/install.sh"
if grep -q '__[A-Z0-9_]*__' "$out/install.sh"; then
	echo "build-dev-release: a placeholder was left in install.sh" >&2
	exit 1
fi
(cd "$out" && sha256sum xmr-bridge-* install.sh > SHA256SUMS)
echo "dev release $version in $out:"
ls -l "$out" | tail -n +2
