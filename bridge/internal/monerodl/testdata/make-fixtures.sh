#!/bin/sh
# Regenerates the download tests' fixtures (session 3b-2): tiny fake Monero release archives and hash lists signed
# by a throwaway key made in a temporary gpg home that is deleted on exit (only its public key is kept). Nothing
# here is a real Monero file. Needs gpg 2.4, tar and bzip2; uses no network. Run from this directory.
set -eu

GNUPGHOME=$(mktemp -d)
export GNUPGHOME
WORK=$(mktemp -d)
trap 'gpgconf --kill all >/dev/null 2>&1 || true; rm -rf "$GNUPGHOME" "$WORK"' EXIT INT TERM
chmod 700 "$GNUPGHOME"
g() { gpg --batch --quiet --no-tty --pinentry-mode loopback --passphrase '' "$@"; }

g --faked-system-time 20190101T000000 --quick-gen-key 'xmr-pay download fixtures <dl@example.invalid>' rsa3072 sign never
K=$(gpg --batch --with-colons --list-keys dl@example.invalid | awk -F: '$1 == "fpr" { print $10; exit }')
g --armor --export "$K" > fixture-key.asc
# The key's parameters for the Go tests (creation time, modulus, exponent in hex), so they needn't parse key files.
gpg --batch --with-colons --with-key-data --list-keys "$K" | awk -F: '
	$1 == "pub" { created = $6; p = 1 } $1 == "sub" { p = 0 }
	p && $1 == "pkd" && $2 == 0 { n = $4 } p && $1 == "pkd" && $2 == 1 { e = $4 }
	END { print "created " created; print "n " n; print "e " e }' > fixture-key.params

# Archives. Deterministic tar (fixed owner, mode and time) so the files only change when this script does.
mk() { # mk <archive> <dir>...  (files are created by the caller under $WORK/<dir>)
	out=$1; shift
	(cd "$WORK" && tar --sort=name --owner=0 --group=0 --numeric-owner --mtime=2026-01-01 -cf - "$@") | bzip2 -9 > "$out"
}
rm -rf "$WORK"/* && mkdir -p "$WORK/monero-x86_64-linux-gnu-v0.18.5.1"
printf 'fake monero-wallet-rpc for linux-x64\n' > "$WORK/monero-x86_64-linux-gnu-v0.18.5.1/monero-wallet-rpc"
printf 'fake monerod\n' > "$WORK/monero-x86_64-linux-gnu-v0.18.5.1/monerod"
printf 'fake license\n' > "$WORK/monero-x86_64-linux-gnu-v0.18.5.1/LICENSE"
chmod 755 "$WORK"/monero-x86_64-linux-gnu-v0.18.5.1/monero*
mk good-x64.tar.bz2 monero-x86_64-linux-gnu-v0.18.5.1

rm -rf "$WORK"/* && mkdir -p "$WORK/monero-aarch64-linux-gnu-v0.18.5.1"
printf 'fake monero-wallet-rpc for linux-armv8\n' > "$WORK/monero-aarch64-linux-gnu-v0.18.5.1/monero-wallet-rpc"
mk good-armv8.tar.bz2 monero-aarch64-linux-gnu-v0.18.5.1

rm -rf "$WORK"/* && mkdir -p "$WORK/monero-x86_64-linux-gnu-v0.18.5.1"
printf 'fake monerod\n' > "$WORK/monero-x86_64-linux-gnu-v0.18.5.1/monerod"
ln -s monerod "$WORK/monero-x86_64-linux-gnu-v0.18.5.1/monero-wallet-rpc"
mk bad-symlink.tar.bz2 monero-x86_64-linux-gnu-v0.18.5.1

# Two copies at the normal depth, so only the "exactly one" rule refuses it.
rm -rf "$WORK"/* && mkdir -p "$WORK/monero-x86_64-linux-gnu-v0.18.5.1" "$WORK/other"
printf 'one\n' > "$WORK/monero-x86_64-linux-gnu-v0.18.5.1/monero-wallet-rpc"
printf 'two\n' > "$WORK/other/monero-wallet-rpc"
mk bad-two.tar.bz2 monero-x86_64-linux-gnu-v0.18.5.1 other

rm -rf "$WORK"/* && mkdir -p "$WORK/monero-x86_64-linux-gnu-v0.18.5.1"
printf 'fake monerod\n' > "$WORK/monero-x86_64-linux-gnu-v0.18.5.1/monerod"
mk bad-missing.tar.bz2 monero-x86_64-linux-gnu-v0.18.5.1

rm -rf "$WORK"/* && mkdir -p "$WORK/monero-x86_64-linux-gnu-v0.18.5.1"
head -c 4096 /dev/zero | tr '\0' 'x' > "$WORK/monero-x86_64-linux-gnu-v0.18.5.1/monero-wallet-rpc"
mk big-entry.tar.bz2 monero-x86_64-linux-gnu-v0.18.5.1

rm -rf "$WORK"/* && mkdir -p "$WORK/monero-x86_64-linux-gnu-v0.18.5.1/deeper"
printf 'nested\n' > "$WORK/monero-x86_64-linux-gnu-v0.18.5.1/deeper/monero-wallet-rpc"
mk bad-nested.tar.bz2 monero-x86_64-linux-gnu-v0.18.5.1

sum() { sha256sum "$1" | cut -d' ' -f1; }
X64=$(sum good-x64.tar.bz2)
ARM=$(sum good-armv8.tar.bz2)

# Hash lists, shaped like Monero's.
rm -f hashes-*.txt
list() { # list <out> then lines on stdin
	cat > "$WORK/msg"
	g --armor --output "$1" --faked-system-time 20260101T000000 --local-user "$K!" --digest-algo SHA256 --clearsign "$WORK/msg"
}
printf '# fixture hash list\n#\n## CLI\n%s  monero-linux-x64-v0.18.5.1.tar.bz2\n%s  monero-linux-armv8-v0.18.5.1.tar.bz2\n%s  monero-linux-armv7-v0.18.5.1.tar.bz2\n#\n## GUI\n%s  monero-gui-linux-x64-v0.18.5.2.tar.bz2\n' \
	"$X64" "$ARM" "$ARM" "$X64" | list hashes-good.txt
printf '## CLI\n%s  monero-linux-x64-v0.18.5.1.tar.bz2\n%s  monero-linux-x64-v0.18.4.0.tar.bz2\n' "$X64" "$X64" | list hashes-two-x64.txt
printf '## CLI\n%s  monero-linux-armv8-v0.18.5.1.tar.bz2\n' "$ARM" | list hashes-no-x64.txt
# For the archive checks: the list names each bad archive as the x64 release.
for b in bad-symlink bad-two bad-missing big-entry bad-nested; do
	printf '## CLI\n%s  monero-linux-x64-v0.18.5.1.tar.bz2\n' "$(sum $b.tar.bz2)" | list "hashes-$b.txt"
done
echo "fixture key: $K"
