#!/bin/sh
# Wyatt runs this after Claude builds a dev release (phase 03, session 3g): signs ~/xmr-pay-dev-data/dev-release/
# release.json with the dev key, exactly as the bridge verifies it (Ed25519 over "xmr-bridge-release-v1\n" followed by
# the file's bytes; base64 signature in release.json.sig), then checks the signature with the public key.
set -eu
umask 077
key="$HOME/xmr-pay-devkeys/dev-release.pem"
rel="$HOME/xmr-pay-dev-data/dev-release"
[ -f "$key" ] || { echo "no dev key: run scripts/dev-release-key.sh first" >&2; exit 1; }
[ -f "$rel/release.json" ] || { echo "no release.json in $rel: Claude builds it first" >&2; exit 1; }
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT INT TERM
{ printf 'xmr-bridge-release-v1\n'; cat "$rel/release.json"; } >"$tmp/message"
openssl pkeyutl -sign -rawin -inkey "$key" -in "$tmp/message" -out "$tmp/sig"
base64 -w0 "$tmp/sig" >"$rel/release.json.sig"
echo >>"$rel/release.json.sig"
chmod 644 "$rel/release.json.sig"
openssl pkey -in "$key" -pubout -out "$tmp/pub.pem"
openssl pkeyutl -verify -pubin -inkey "$tmp/pub.pem" -rawin -in "$tmp/message" -sigfile "$tmp/sig" >/dev/null
echo "signed $(sed -n 's/.*"version":"\([^"]*\)".*/\1/p' "$rel/release.json") and checked the signature"
