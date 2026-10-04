#!/bin/sh
# Regenerates the hash-list verifier's signed test files (session 3b-1). Two throwaway RSA keys are made in a
# temporary gpg home that is deleted on exit; only their public keys and the signed files are kept. No private key
# is ever written here (CLAUDE.md: never commit a private key). The real Monero files (hashes.txt, binaryfate.asc)
# are downloaded separately and are not touched by this script.
#
# Run from this directory: ./make-corpus.sh   (needs gpg 2.4; uses no network)
set -eu

GNUPGHOME=$(mktemp -d)
export GNUPGHOME
trap 'gpgconf --kill all >/dev/null 2>&1 || true; rm -rf "$GNUPGHOME"' EXIT INT TERM
chmod 700 "$GNUPGHOME"

g() { gpg --batch --quiet --no-tty --pinentry-mode loopback --passphrase '' "$@"; }

# Keys are dated 2019 so a signature made "in 2020" (the expired case) is newer than its key.
old=20190101T000000
g --faked-system-time "$old" --quick-gen-key 'xmr-pay test signer A <a@example.invalid>' rsa3072 sign never
g --faked-system-time "$old" --quick-gen-key 'xmr-pay test signer B <b@example.invalid>' rsa3072 sign never
fpr() { gpg --batch --with-colons --list-keys "$1" | awk -F: '$1 == "fpr" { print $10; exit }'; }
A=$(fpr a@example.invalid)
B=$(fpr b@example.invalid)
g --faked-system-time "$old" --quick-add-key "$A" rsa3072 sign never
ASUB=$(gpg --batch --with-colons --list-keys "$A" | awk -F: '$1 == "fpr" { n++ } $1 == "fpr" && n == 2 { print $10; exit }')

g --armor --export "$A" > testkey-a.asc
g --armor --export "$B" > testkey-b.asc

# The message: comments, hash lines, a line that gets dash-escaped, trailing whitespace (stripped when hashing).
cat > message.txt <<'MSG'
# xmr-pay hash-list verifier test file. Not a real Monero release.
#
## CLI
1111111111111111111111111111111111111111111111111111111111111111  monero-linux-x64-v0.18.5.1.tar.bz2
2222222222222222222222222222222222222222222222222222222222222222  monero-linux-armv8-v0.18.5.1.tar.bz2   
-- a line starting with a dash is dash-escaped in the signed file
#	
MSG

sign() { out=$1; shift; g --armor --output "$out" "$@" --clearsign message.txt; }
rm -f good-*.txt bad-*.txt
sign good-sha256.txt          --local-user "$A!" --digest-algo SHA256
sign good-sha512.txt          --local-user "$A!" --digest-algo SHA512
sign good-expires-later.txt   --local-user "$A!" --digest-algo SHA256 --default-sig-expire 50y
sign bad-wrong-signer.txt     --local-user "$B!" --digest-algo SHA256
sign bad-subkey-signer.txt    --local-user "$ASUB!" --digest-algo SHA256
sign bad-two-signatures.txt   --local-user "$A!" --local-user "$B!" --digest-algo SHA256
sign bad-sha384.txt           --local-user "$A!" --digest-algo SHA384
sign bad-expired.txt          --local-user "$A!" --digest-algo SHA256 --faked-system-time 20200101T000000 --default-sig-expire 1d
# Signed with SHA512 but the armor header claims SHA256.
sed 's/^Hash: SHA512$/Hash: SHA256/' good-sha512.txt > bad-hash-header-mismatch.txt

echo "test key A: $A (signing subkey $ASUB)"
echo "test key B: $B"
