# Spike Q7: view-only shop wallet (throwaway, phase 01)

`q7-wallet.mjs` talks to `monero-wallet-rpc` on 127.0.0.1:38083. Start it (no secrets on its command line):

```bash
tmux new -d -s walletrpc "/opt/monero/monero-wallet-rpc --stagenet --daemon-address 127.0.0.1:38081 --trusted-daemon --wallet-dir $HOME/xmr-pay-dev-data/wallets --rpc-bind-ip 127.0.0.1 --rpc-bind-port 38083 --disable-rpc-login --non-interactive --log-level 0 --log-file $HOME/xmr-pay-dev-data/wallet-rpc.log; exec bash"
```

Then, from the repo root: `scripts/with-shop-env.sh node spikes/wallet/q7-wallet.mjs create` once (the view key travels only in that one request body), and `node spikes/wallet/q7-wallet.mjs status | addresses | transfers`. `check-log <file>` (through the wrapper) reports whether the view key appears in a file without printing it.

Stop: `tmux kill-session -t walletrpc`. The view-only wallet files are in `~/xmr-pay-dev-data/wallets/` (mode 700) and are deleted when the spike ends.
