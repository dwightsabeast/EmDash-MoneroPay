package selfupdate

// GuardScript is /var/lib/xmr-bridge/bin/update-guard.sh, run by systemd before each start (ExecStartPre, without
// "+", so as the xmr-bridge user: root never runs anything the service can write). While an update is pending it
// counts starts; the new binary resets the count once it has started properly (wallet-rpc ready, wallet open), so
// only starts that die early add up. On the 4th such start it puts the previous files back (for wallet-rpc, also the
// wallet backup), records the version as refused, and clears the pending update. It always exits 0.
const GuardScript = `#!/bin/sh
# update-guard.sh: written by xmr-bridge; run by systemd before each start of the wallet host, as the xmr-bridge user.
set -u
umask 077
D="${XMR_BRIDGE_DATA:-/var/lib/xmr-bridge}"
R="$D/run"
[ -f "$R/update-pending" ] || exit 0
n=$(cat "$R/start-count" 2>/dev/null || echo 0)
case "$n" in '' | *[!0-9]*) n=0 ;; esac
n=$((n + 1))
echo "$n" >"$R/start-count"
[ "$n" -ge 4 ] || exit 0
kind=$(sed -n 's/^kind=//p' "$R/update-pending")
ver=$(sed -n 's/^version=//p' "$R/update-pending")
case "$kind" in
bridge)
	[ -f "$D/bin/xmr-bridge.prev" ] && mv -f "$D/bin/xmr-bridge.prev" "$D/bin/xmr-bridge"
	;;
wallet-rpc)
	[ -f "$D/bin/monero-wallet-rpc.prev" ] && mv -f "$D/bin/monero-wallet-rpc.prev" "$D/bin/monero-wallet-rpc"
	[ -f "$D/bin/installed.json.prev" ] && mv -f "$D/bin/installed.json.prev" "$D/bin/installed.json"
	for f in shop shop.keys; do
		[ -f "$D/wallet/backup/$f" ] && cp -p "$D/wallet/backup/$f" "$D/wallet/$f"
	done
	;;
esac
echo "$kind=$ver" >>"$R/refused"
rm -f "$R/update-pending" "$R/start-count"
echo "xmr-bridge: the update to $kind $ver didn't start 3 times in a row; rolled back and refused it" >&2
exit 0
`
