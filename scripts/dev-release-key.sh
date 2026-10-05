#!/bin/sh
# Wyatt runs this once (phase 03, session 3g): makes the DEV release signing key with openssl in ~/xmr-pay-devkeys/
# (mode 600, never committed, dev only: the real release key is made fresh in phase 09, elsewhere, and never kept on
# this box), and writes its public key, base64 of the raw 32 bytes, to ~/xmr-pay-dev-data/dev-release.pub for the
# dev builds. Claude can't read ~/xmr-pay-devkeys/ (a deny rule), so Claude never runs this.
set -eu
umask 077
dir="$HOME/xmr-pay-devkeys"
key="$dir/dev-release.pem"
pub="$HOME/xmr-pay-dev-data/dev-release.pub"
mkdir -p "$dir"
chmod 700 "$dir"
if [ ! -f "$key" ]; then
	openssl genpkey -algorithm ed25519 -out "$key"
	echo "made a new dev release key: $key"
else
	echo "keeping the existing dev release key: $key"
fi
chmod 600 "$key"
openssl pkey -in "$key" -pubout -outform DER | tail -c 32 | base64 >"$pub"
chmod 644 "$pub"
echo "public key written to $pub: $(cat "$pub")"
