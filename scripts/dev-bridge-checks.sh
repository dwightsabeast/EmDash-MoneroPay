#!/bin/sh
# Session 3f-2: checks Wyatt runs on the dev box after installing the wallet host (they need sudo). Everything goes
# to one file Claude reads: ~/xmr-pay-dev-data/3f-checks-output.txt. No secrets are printed: the view key is only
# in the wallet, and nothing here reads the wallet or the key.
#
#   sh ~/xmr-pay/scripts/dev-bridge-checks.sh
set -u
out="$HOME/xmr-pay-dev-data/3f-checks-output.txt"
exec >"$out" 2>&1
step() { printf '\n===== %s  (%s)\n' "$*" "$(date -u +%H:%M:%S)"; }

step "xmr-bridge status"
sudo xmr-bridge status --config /etc/xmr-bridge/config; echo "exit $?"
step "systemctl status"
systemctl status xmr-bridge --no-pager -l | head -20
step "journal (last 40 lines)"
sudo journalctl -u xmr-bridge --no-pager -n 40
step "installed files"
sudo ls -la /var/lib/xmr-bridge /var/lib/xmr-bridge/bin /var/lib/xmr-bridge/wallet /etc/xmr-bridge
ls -la /usr/local/bin/xmr-bridge
step "processes (user, pid, command)"
ps -eo user,pid,args | grep -E 'xmr-bridge|monero-wallet-rpc' | grep -v grep
step "hardening (systemd-analyze security, live)"
systemd-analyze security xmr-bridge --no-pager | tail -3

step "restart the service"
sudo systemctl restart xmr-bridge
sleep 45
sudo xmr-bridge status --config /etc/xmr-bridge/config; echo "exit $?"

step "kill -9 monero-wallet-rpc (the bridge should restart it)"
sudo pkill -KILL -u xmr-bridge -x monero-wallet-r; echo "pkill exit $?"
sleep 30
ps -eo user,pid,args | grep -E 'monero-wallet-rpc' | grep -v grep
sudo journalctl -u xmr-bridge --no-pager -n 8
sudo xmr-bridge status --config /etc/xmr-bridge/config; echo "exit $?"

step "uninstall (keeps the data)"
sudo xmr-bridge uninstall; echo "exit $?"
systemctl status xmr-bridge --no-pager 2>&1 | head -3
sudo ls -la /var/lib/xmr-bridge/wallet
ls -la /usr/local/bin/xmr-bridge 2>&1
step "done"
