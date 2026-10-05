#!/bin/sh
# Claude's check of Wyatt's dev release signature, using only the public key (~/xmr-pay-dev-data/dev-release.pub):
# the raw 32-byte Ed25519 key is wrapped in its standard DER prefix, then openssl verifies release.json.sig over
# "xmr-bridge-release-v1\n" + release.json. Never touches ~/xmr-pay-devkeys/.
set -eu
rel="$HOME/xmr-pay-dev-data/dev-release"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT INT TERM
{ printf '\060\052\060\005\006\003\053\145\160\003\041\000'; base64 -d <"$HOME/xmr-pay-dev-data/dev-release.pub"; } >"$tmp/pub.der"
openssl pkey -pubin -inform DER -in "$tmp/pub.der" -out "$tmp/pub.pem"
{ printf 'xmr-bridge-release-v1\n'; cat "$rel/release.json"; } >"$tmp/message"
base64 -d <"$rel/release.json.sig" >"$tmp/sig"
openssl pkeyutl -verify -pubin -inkey "$tmp/pub.pem" -rawin -in "$tmp/message" -sigfile "$tmp/sig"
