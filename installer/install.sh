#!/bin/sh
# xmr-pay wallet host installer.
#
#   curl -fsSL <release host>/install.sh | sh -s -- --site https://your-site.example --pair <one-time code>
#
# It downloads the xmr-bridge program for this machine's CPU, checks it against the SHA-256 written into this file
# for this release, and runs `xmr-bridge install` with sudo. That program asks for the shop wallet's address and
# private view key on the terminal (never on the command line), checks this machine isn't serving the site, sets up
# a background service and pairs with the site. The cautious path does the same by hand: download xmr-bridge,
# check it, run `sudo ./xmr-bridge install --site ... --pair ...`.
#
# The build fills in the four values below; the copy in the repository is a template and refuses to run.
set -eu

RELEASE_BASE="__RELEASE_BASE__"
VERSION="__VERSION__"
SHA256_AMD64="__SHA256_AMD64__"
SHA256_ARM64="__SHA256_ARM64__"
CURL_PROTO="__CURL_PROTO__"

fail() {
	printf 'xmr-pay installer: %s\n' "$*" >&2
	exit 1
}

case "$RELEASE_BASE$VERSION$CURL_PROTO" in
*__*) fail "this install.sh is a template; use the one from a release" ;;
esac
[ "$(uname -s)" = "Linux" ] || fail "the wallet host runs on Linux only"
case "$(uname -m)" in
x86_64 | amd64) arch=amd64 sum=$SHA256_AMD64 ;;
aarch64 | arm64) arch=arm64 sum=$SHA256_ARM64 ;;
*) fail "no xmr-bridge for this CPU ($(uname -m)); x86-64 and 64-bit ARM are supported" ;;
esac
command -v curl >/dev/null 2>&1 || fail "curl is needed"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is needed (coreutils)"
if [ "$(id -u)" -eq 0 ]; then
	as_root=""
else
	command -v sudo >/dev/null 2>&1 || fail "run this as root, or install sudo"
	as_root="sudo"
fi

# A folder for the download; /tmp may forbid running programs, so fall back to the home folder.
dir=$(mktemp -d "${TMPDIR:-/tmp}/xmr-pay.XXXXXX")
trap 'rm -rf "$dir"' EXIT INT TERM
bin="$dir/xmr-bridge"

printf 'Downloading xmr-bridge %s for %s...\n' "$VERSION" "$arch"
curl -fsSL --proto "$CURL_PROTO" -o "$bin" "$RELEASE_BASE/xmr-bridge-$VERSION-linux-$arch" || fail "the download failed"
got=$(sha256sum "$bin" | cut -d ' ' -f 1)
[ "$got" = "$sum" ] || fail "the download doesn't match this release's checksum; nothing was installed"
chmod 755 "$bin"
if ! "$bin" version >/dev/null 2>&1; then
	home_dir=$(mktemp -d "$HOME/.xmr-pay.XXXXXX") || fail "can't run the download from ${TMPDIR:-/tmp}"
	cp "$bin" "$home_dir/xmr-bridge" || fail "can't run the download from ${TMPDIR:-/tmp}"
	rm -rf "$dir"
	dir=$home_dir
	bin="$dir/xmr-bridge"
	"$bin" version >/dev/null 2>&1 || fail "the downloaded program doesn't run on this machine"
fi
printf 'Checked: SHA-256 matches this release. Starting the installer%s...\n' "${as_root:+ (sudo may ask for your password)}"

# The installer reads its questions from the terminal itself, so this works when the script is piped from curl.
if (: </dev/tty) 2>/dev/null; then
	$as_root "$bin" install "$@" </dev/tty
else
	$as_root "$bin" install "$@"
fi
