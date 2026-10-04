# Phase 05 — Setup test (human-run)

**Goal:** prove the admin budget on a real, separate machine: under 15 minutes from install to a settled test tip, with no help. This phase is run by people; Claude prepares it and fixes what it finds.
**Spec sections:** Admin setup and upkeep (the budget, prerequisites, install flow), Build plan step 5, Open questions 15 and 17.
**Done when:** two timed runs (own node, remote node) both finish under 15 minutes with no help, or every overrun and every point of confusion has a fix merged and the run has been repeated.

## For Wyatt

**Before the prep session**

- [ ] Phases 02–04 are done.
- [ ] A second container on Proxmox to be the wallet host: Debian 12 or Ubuntu 24.04, 1 core, 1–2 GB RAM, 16 GB disk, nothing else installed. Snapshot it as `blank` so each run starts clean.
- [ ] For the own-node run: a stagenet node the wallet host can reach on your LAN. Simplest is the dev box's node with a second, restricted RPC listener on the LAN, keeping the localhost one everything else uses: add `--rpc-restricted-bind-ip`, set to the dev box's LAN address (in the Machine table of `docs/dev-environment.md`), plus `--rpc-restricted-bind-port 38089 --confirm-external-bind` to the `monerod-stagenet` service (check `monerod --help` for the exact names), then `sudo systemctl daemon-reload && sudo systemctl restart monerod-stagenet`. When the installer asks for the node address, give that LAN address with port `38089`.
- [ ] The public test hostname from phase 01 (built copy of the dev site, Cloudflare Access with the plugin-route bypass), up for the duration of the test.
- [ ] For the remote-node run: a public stagenet node from a current node list.
- [ ] A tester who hasn't seen the project, if you can find one. If not, run it yourself using only the admin-facing instructions, and write down every pause.

**The registry click can't be tested yet** (nothing is published). The plugin is installed config-managed on the dev site, and the clock starts at "open the plugin's admin page". Phase 09 repeats the run from the registry.

**Start the prep session:**

```text
Phase 05, setup test. Read docs/phases/05-setup-test.md and docs/progress.md, then write the test protocol.
```

## For Claude

**Prep session**

1. Read `docs/setup-friction.md` first: the admin-facing instructions must avoid every pattern it lists (unclear machine or user, pasteable placeholders, steps with no check, no way back). Then write `docs/setup-test.md`: the admin-facing instructions exactly as an admin would get them (no repo knowledge assumed), a timing sheet (one row per step in the spec's install flow, with start and end times), a confusion log (what they hesitated over, what they asked, what they misread), and pass or fail criteria. The instructions end with a check the tester can see: open the shop's wallet app (the one holding the shop wallet's seed, not the wallet host) and confirm that the test tip shows up there, with its amount. That check is a row in the timing sheet and a pass criterion: a tip settled on the site but missing from the wallet app fails the run (see spec change 9).
2. Prepare the install command the tester will paste on the wallet-host container. The site URL is the public test hostname (HTTPS, as a real admin would have). The install script and bridge come from phase 03's dev release mode: built with the dev key from `~/xmr-pay-devkeys/`, served from the dev box on the LAN, stagenet only. Never the real key. Give Wyatt a one-line check he can run on the container first to confirm it can reach both the site and the release location.
3. List what Wyatt resets between runs: roll the container back to `blank`, remove the bridge key in the plugin (press Connect wallet host again).
4. Everything on the wallet-host container is done by Wyatt or the tester; you have no access to it. Give exact commands for anything they need to check there (`xmr-bridge status`, `journalctl -u xmr-bridge`).

**Triage session (after the runs)**

- Turn every overrun, error and confusion into a fix: wording on the admin page, an installer message, a default, or a bug. Prefer removing a step to explaining it.
- Anything that would need a new setting, prompt or step goes to Wyatt first.
- Record results and fixes in `docs/progress.md` and update `docs/setup-test.md`.

**Out of scope:** publishing; the real install host.
