# Phase 03 — Bridge and installer

**Goal:** `xmr-bridge`, a single static Go binary that installs itself as a systemd service, downloads and verifies Monero's `monero-wallet-rpc`, runs it with a view-only wallet, pairs with the site, and pushes signed snapshots; plus `install.sh`, the one command the admin pastes.
**Spec sections:** Bridge service (all of it), API contracts (`bridge/sync`), Admin setup and upkeep, Security model (wallet host, tampered downloads, dishonest remote node), Open questions 12, 15, 16, 17.
**Done when:** on the dev box, with the stagenet-only same-machine flag, `install.sh` sets up the service, pairing succeeds (the minimal admin page from phase 02 shows the bridge key), and a stagenet payment Wyatt sends from his buyer wallet settles in the dev site. Restart and outage tests pass.

## For Wyatt, before the session

- [ ] Phase 02 is done; the plugin runs in the dev site and pairing works with a scripted fake bridge.
- [ ] Be ready to choose (Claude will lay out options in its plan):
  - how the bridge checks Monero's GPG-signed `hashes.txt` (a maintained OpenPGP library such as ProtonMail's `go-crypto`, or the system's `gpgv`, which isn't on every distro);
  - the release signature scheme for the bridge's own updates (Ed25519 with Go's standard library, verified against a public key pinned in the binary).
- [ ] You'll send a few stagenet payments by hand from your buyer wallet during the end-to-end test.
- [ ] You'll run the installer yourself (it needs `sudo`, which Claude can't use), typing the stagenet shop address and view key at its prompts, plus a few `sudo systemctl` and `kill` commands Claude gives you for the restart tests.

**Start the session:**

```text
Phase 03, bridge and installer. Read docs/phases/03-bridge-and-installer.md, docs/progress.md and docs/spike-findings.md, then plan the first session (3a).
```

## For Claude

**Suggested sessions**

| Session | Scope |
| --- | --- |
| 3a | Go module in `bridge/` (`CGO_ENABLED=0`, standard library first). Config file, subcommands, logging. wallet-rpc JSON-RPC client with HTTP digest auth (`--rpc-login` uses digest), tested against an `httptest` fake |
| 3b-1 | The `hashes.txt` verifier (spec revision 70, Bridge service, "Decision: how the bridge checks Monero's signed hash list"). First confirm the pinned key's algorithm from binaryFate's published key (`gpg --show-keys`, no import). Then write the standard-library verifier, a tampered set of test files (signed by a throwaway key made in a temporary `gpg` home and deleted afterwards; only its public key and the signed files are committed), fuzzing, and the CI-only comparison checks (`gpgv` and ProtonMail `go-crypto` in the separate module `bridge/oracle/`) |
| 3b-2 | Download and verify `monero-wallet-rpc`: fetch `hashes.txt`, verify it with the 3b-1 verifier against the pinned binaryFate key, fetch the archive for the CPU (linux64 or linuxarm8), check SHA-256, extract only `monero-wallet-rpc` (`compress/bzip2`, `archive/tar`). Supervise it as a child: localhost bind, generated login, `--tx-notify` wired back to the bridge |
| 3c | Wallet from keys: `generate_from_keys` with address and view key (no spend key), restore height from the node's current height unless set. Network check: address prefix must match the node's network |
| 3d | Ed25519 keypair (`crypto/ed25519`, key file mode 600), pairing with the one-time code, the sync loop (10–15 s and on tx-notify), `get_transfers` with `in` and `pool` filtered by watched `subaddr_indices`, field pass-through, pool top-up with `create_address`, reconcile on start, backoff when the site is unreachable, `xmr-bridge status` |
| 3e | Remote-node cross-check: compare the block hash at each payment height with a second node before reporting confirmations; hold at 0 and report a red check on mismatch |
| 3f | `installer/install.sh` and the systemd unit |
| 3g | Signed self-update with a test key, staged rollout delay, rollback if the new binary fails its health check |
| 3h | End-to-end on stagenet with the dev site |
| 3i | Spec change 15: a reinstalled bridge catches its wallet up to the site's pool (`poolTop`, create, one rescan); L3 rerun on stagenet (added 2026-10-07) |
| 3j | Spec changes 16 (the site's chain height: never lowered; checkout refuses while the bridge is silent) and 17 (the pairing response suggests a reinstall's restore height) (added 2026-10-08) |

**Running it without root.** Most of this phase runs the bridge in the foreground as the `dev` user (`xmr-bridge run --config <file under ~/xmr-pay-dev-data/>`), launched through `scripts/with-shop-env.sh` so the view key comes from the environment. Only the installer and the systemd unit need root; for those, give Wyatt the exact commands.

**Before a release exists (dev release mode).** The real release host and signing key arrive in phase 09, but the install and update paths must be tested now. Propose this in the 3a plan: a dev build (Go build tag) that pins a throwaway dev public key, generated by you in `~/xmr-pay-devkeys/`, and accepts a `--release-url` pointing at a local or LAN directory only on stagenet or regtest. A build script produces the dev bridge, a dev `install.sh` with the dev key pinned, checksums and dev signatures. Release builds must exclude the dev key and the `--release-url` option; phase 09 tests that.

**Rules specific to the bridge**

- The bridge never handles a spend key, and refuses input that looks like one or like a seed.
- Signing must match the plugin byte for byte: use `contract/test-vectors/sync-signature.json` from phase 02 in Go tests.
- Pin Monero's signer fingerprint `81AC 591F E9C4 B65C 5806 AFC3 F0AF 4D46 2A0B DF92` in code. A signature from any other key fails closed. Check the archive's SHA-256 against the verified `hashes.txt` before extracting.
- The release-signing public key is a placeholder until Wyatt provides the real one in phase 09. Unit tests generate keys at run time or use the RFC 8032 test vectors; the dev release key lives in `~/xmr-pay-devkeys/`. Never commit a private key.
- Mainnet must be possible but is never exercised here. The same-machine dev flag works only on stagenet (and regtest, if adopted); on mainnet it is refused.

**Installer (`install.sh`)**

- POSIX `sh`, works when piped from `curl`, so read prompts from `/dev/tty`. Hide the view key while typing. Values never go on the command line or into shell history.
- Local-node detection must try `localhost` on both loopback addresses (`127.0.0.1` and `::1`); on the dev box, `astro dev` answered only on `::1` (see `docs/setup-friction.md`).
- Steps, in the spec's order: same-machine check, download the bridge for this CPU and verify it, prompt for address and view key, prompt for a node only if no local `monerod` answers, then hand off to `xmr-bridge install`, which downloads and verifies wallet-rpc, writes `/etc/xmr-bridge/config`, creates the `xmr-bridge` system user, pairs, creates the wallet (from the site's suggested restore height when it has open invoices, spec change 17, session 3j), and installs and starts the systemd unit.
- Same-machine check: look for signs of an EmDash site on this machine (an Astro or EmDash server process, an `astro.config.*` that imports `emdash`, the site URL resolving to this host). Document how reliable each signal is (open question 17).
- systemd hardening: `NoNewPrivileges`, `ProtectSystem=strict` with explicit `ReadWritePaths`, `ProtectHome`, `PrivateTmp`, `RestrictAddressFamilies`, a dedicated user, no inbound listeners.
- The cautious path from the spec must work: download, verify by hand, run `xmr-bridge install --site <url> --pair <code>`.
- Uninstall: `xmr-bridge uninstall` stops the service and removes it; it keeps the wallet directory unless asked, and says where it is.

**Tests**

- Go unit tests with fakes for wallet-rpc, the node(s) and the site: signing vectors, digest auth, snapshot building, pool top-up, reconcile on start, backoff, cross-check mismatch, update verification (good, bad signature, wrong key, downgrade attempt).
- Download verification: a tampered `hashes.txt`, a wrong signer, a wrong archive hash; all fail closed.
- If Wyatt approved regtest in phase 01: chain tests with throwaway regtest wallets (send, confirm, pop blocks for a reorg, a double-spend if feasible). Otherwise these stay covered by the plugin-side scenario tests.
- Installer: unit-test its pieces (argument parsing, prompts read from `/dev/tty`, the same-machine check, the network check) with a fake root directory; `shellcheck` it if Wyatt approves installing shellcheck. The real install runs by Wyatt's hand: on the dev box with the stagenet-only same-machine flag now, and on the second container in phase 05. There's no container runtime on the dev box.
- End to end on stagenet (3h), each with Wyatt sending payments: happy path, two-part payment, underpayment, late payment, bridge stopped across an invoice's expiry then restarted, wallet-rpc killed (supervisor restarts it), site unreachable for a few minutes, re-pairing after deleting the bridge's key.
- Subaddress lookahead (spec change 9, proposed; Wyatt's decision on it may change this), on stagenet:
  - **Gap:** create more than 200 addresses past the last paid index (`create_address` on the bridge's wallet is enough; no need for 200 checkouts), have Wyatt pay the furthest one, and check that the bridge reports it.
  - **Shop wallet stand-in:** a second view-only wallet-rpc restored from the same keys with default settings plays the shop's wallet app. Record whether it sees the payment, and what makes it appear.
  - **Reinstall:** a reinstalled bridge (a fresh wallet from keys) recreates addresses up to the highest pool index before it reconciles, and sees payments to high indexes.
  - Record the evidence in spec change 9.

**Stop points:** the GPG-verification approach, the release-signature scheme and the dev release mode (Wyatt decides from your options); any dependency; any extra installer prompt or setting; anything needing `sudo` (Wyatt runs it).

**Out of scope:** publishing releases, the real signing key, hosting `install.sh` (all phase 09).
