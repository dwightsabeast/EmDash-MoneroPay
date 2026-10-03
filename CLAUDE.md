# xmr-pay — Claude Code ground rules

This repo builds **xmr-pay**: a sandboxed EmDash plugin that takes Monero payments and tips, plus a small Go bridge and a one-command Linux installer for the wallet host. The plugin holds no wallet keys and never calls the wallet; the bridge pushes Ed25519-signed snapshots in.

The owner is Wyatt. He makes every design decision and handles every account, key and release. You write code, tests and docs on this dev box. Repository: https://github.com/dwightsabeast/EmDash-MoneroPay (cloned at `~/xmr-pay`).

## Where the truth lives

| What | Where |
| --- | --- |
| Design (source of truth) | `docs/spec.md`, a snapshot of the live spec (link at its top). The spec wins over your own ideas. |
| Decisions already made | `docs/decisions.md`. Do not reopen these unless Wyatt asks. |
| The phase you're on | `docs/phases/NN-*.md`, one phase per session. `docs/phases/README.md` is the index. |
| What happened so far | `docs/progress.md`. Read it first; append to it last. |
| Proposed design changes | `docs/spec-changes.md`. Write proposals here, never edit `docs/spec.md`. |
| Setup snags and their lessons | `docs/setup-friction.md`. Add a row whenever a setup step trips Wyatt or you. |
| Dev box facts | `docs/dev-environment.md` (local only, gitignored) |
| EmDash reference | `emdash-docs` MCP server (`search_docs`), then `docs/reference/emdash-knowledge-base.md`, then the installed packages' type definitions. Prefer these over memory. Never put private code, keys or user data in a docs query. |
| Working reference model | `docs/poc/poc-simulation.js` (the proof of concept's logic and scenarios) and `docs/poc/findings.md` |

## How we work

1. Start each session by reading `docs/progress.md`, then the phase file Wyatt names, then the spec sections that phase lists.
2. Plan first. Sessions start in plan mode. Present a short plan: files to create or change, tests to write, open questions, anything that needs Wyatt. Wait for approval.
3. Tests first. Write the failing test, then the code. Port the proof of concept's scenarios as tests rather than inventing new behavior.
4. Small steps, each one green: tests pass, types check, lint clean, then a local commit with a clear message.
5. Stay inside the phase. If you find work for a later phase, note it in `docs/progress.md` instead of doing it.
6. End every session by appending to `docs/progress.md`: date, phase, what was done, test results, open issues, the exact next step.
7. Wyatt is a test engineer. Show test plans and results plainly: what was run, what passed, what was not covered.
8. Some steps happen where you can't go: anything needing `sudo` (you have no terminal for its password), the wallet-host test container, Wyatt's PC (his SSH tunnel), and the public test hostname. Wyatt can't paste output back into Claude Code, so hand him a file and get a file back, as described in "Working with Wyatt's PC" below. Never a list of blocks to copy.
9. Folders scaffolded by EmDash tools (for example `plugin/AGENTS.md` and its `.claude/` links) carry EmDash's own agent guidance. Use it for EmDash API details; where it conflicts with this file, this file wins.

## Stop and ask Wyatt before you

- Change the plugin's trust contract: `capabilities`, `allowedHosts`, `storage` collections or indexes, routes (names, public or private, methods), or admin pages and widgets.
- Add any setting, install prompt, admin step, or routine upkeep task (see the admin budget below).
- Add, remove or upgrade any dependency (npm, Go module, system package, GitHub Action).
- Deviate from the spec, or find that EmDash or Monero behaves differently from what the spec assumes. Write the evidence and a proposal in `docs/spec-changes.md` first.
- Push to GitHub, create tags or releases, publish to the EmDash registry or npm, or log in to any account.
- Touch anything outside your working areas: this repo, the dev site (`~/sites/xmr-dev-site`), `~/xmr-pay-dev-data/` (wallet-rpc and regtest data), `~/xmr-pay-devkeys/` (throwaway dev signing keys), `~/work/` (clones of third-party repos) and temp directories. `sudo` and system services are Wyatt's (see step 8 above).
- Spend more than about 30 minutes stuck on one problem. Summarize what you tried.

## Non-negotiables

**Keys and wallets**

- Never request, read, print, log, store or commit the seed, mnemonic or spend key of any real wallet (Wyatt's stagenet wallets included, and anything mainnet). Not in code, tests, fixtures, logs, commit messages or chat.
- The one exception is throwaway **regtest** wallets that a test creates under `~/xmr-pay-dev-data/` and deletes afterwards. Never print their seeds or keys either.
- `~/stagenet-wallets/` is Wyatt's. Never open it. The shop wallet's stagenet address and view key live in `~/.config/xmr-pay-dev/stagenet.env`. Run programs that need them through `scripts/with-shop-env.sh <command>`; never source or read the file yourself, and never run `env`, `printenv`, `set -x` or anything that echoes those variables. Pass the view key to wallet-rpc on stdin (`curl --data @-`), not on a command line.
- Release signing has two keys. The **real** private key is generated offline by Wyatt and never comes near this box; only its public key is ever pinned, when he provides it. A **dev** key for testing the update and install path may be generated in `~/xmr-pay-devkeys/` (outside the repo); dev builds pin it, release builds must not.
- Signature test vectors use the published RFC 8032 test keys. Never commit any other private key, test or not.

**Plugin trust contract (frozen)**

- `capabilities`: exactly `["content:read", "network:request"]`.
- `allowedHosts`: exactly `["api.coingecko.com", "api.kraken.com"]`.
- Routes: `checkout` (POST, public), `status` (GET, public), `bridge/sync` (POST, public, signed, raw bytes body), `admin` (POST, private).
- Storage: `pool` and `invoices`, with the indexes in the spec's manifest.
- The plugin never calls the wallet, a node, the bridge, or any host but the two price APIs. It stores no wallet material and no credentials: only the bridge's public key, a hash of the pairing code, and a salt for short-lived rate-limit hashes.

**Payment logic**

- Amounts are BigInt atomic units (1 XMR = 10^12), stored as decimal strings. Never `Number` or floats for money. Fiat is integer minor units. `expectedAtomic = ceil(fiatMinor * 10^12 / rateMinor)`.
- Nothing is fulfilled at zero confirmations. Only counted transfers move an invoice: `unlockTime === "0"` and not `doubleSpendSeen`.
- `required` confirmations are locked on the invoice at checkout. Expire on evidence, never on the plugin's own clock alone. The spec's lifecycle rules are the contract; the proof of concept implements them.
- Verify the timestamp and signature before parsing a sync body. The only exception is the pairing case the spec describes.

**Networks and downloads**

- Development uses stagenet (`monerod` on `127.0.0.1:38081`) and, if the spike approves it, regtest. Never mainnet. Mainnet code paths exist but you never exercise them.
- Every downloaded binary is verified: Monero's against its GPG-signed `hashes.txt` (signer fingerprint `81AC 591F E9C4 B65C 5806 AFC3 F0AF 4D46 2A0B DF92`), Go modules through `go.sum`, npm packages through the lockfile. Never pipe a download into a shell.

**Leave alone**

- Wyatt's live site (wyattdilley.com), its server and container, DNS, Cloudflare, and any other machine. No SSH or SCP anywhere.
- Never expose `npm run dev` (Astro dev mode) beyond this box: it has a sign-in shortcut meant only for local use. The public test hostname points at a built copy of the dev site behind Cloudflare Access (see `docs/dev-environment.md`).

## The admin budget (product rule)

Setup must stay under 15 minutes from the registry click to a confirmed test payment, with no required settings, two values typed once (shop address and view key), one command on the wallet host, no software to install first, and no routine upkeep. If a change would break the budget, the feature changes, not the budget, and Wyatt decides.

Fixed platform decisions: wallet host on Linux only (systemd) at launch; it must be a separate machine from the site (the installer refuses otherwise; a stagenet-only dev flag allows one machine); own `monerod` recommended, a remote node allowed; Monero's official `monero-wallet-rpc` does the wallet work; no Docker requirement; no in-plugin watcher or "quick setup" mode.

## Dependencies

- Ask first, every time. Give the package, its maintainers, size, license and why the standard library or EmDash's own packages won't do.
- No single-maintainer libraries for crypto, wallet or money logic (monero-ts was rejected for this reason).
- Go: standard library only, JavaScript: see the tiers below. Pin exact versions and commit lockfiles.
- The plugin bundle has hard caps: `backend.js` at most 128 KB and the whole tarball at most 256 KB decompressed. Check with `pnpm exec emdash-plugin bundle --validate-only` before every commit that touches `plugin/`.

## Dependency tiers

Decided by Wyatt on 2026-10-03 (`docs/decisions.md`). Asking first still applies within each tier; a tier says what may be asked for at all.

**1. Shipped code has no third-party runtime code.** This covers the plugin bundle, the bridge, the installer and the theme components.

- Plugin: our code plus, at most, EmDash's own plugin helpers. Signatures use WebCrypto, money uses BigInt, input validation is hand-written (no `zod` or other schema library), and Block Kit is written as plain JSON (no `@emdash-cms/blocks`).
- Bridge: the Go standard library. Any exception (the OpenPGP check of Monero's `hashes.txt`) is decided in phase 03.
- Installer: POSIX `sh`.
- Theme: no runtime npm packages. A QR encoder, if one is needed, is vendored as reviewed source with its license.

**2. Dev tooling (never shipped)** is limited to EmDash's own toolchain and what it requires (for example `@emdash-cms/plugin-cli`, `@emdash-cms/plugin-test`, `emdash`, `vitest`, `typescript`).

- Exact pins and committed lockfiles.
- Install scripts blocked except an allowlist. In pnpm: `strictDepBuilds: true` and `allowBuilds` in the package's `pnpm-workspace.yaml`; the allowlist is `esbuild` and `workerd`.
- A 7-day minimum release age. In pnpm 12: `minimumReleaseAge: 10080` (minutes), which also makes the check strict. Exceptions only with Wyatt's approval, as exact versions in `minimumReleaseAgeExclude`, each with a removal date (the day it would pass on its own) and a matching reminder in `docs/progress.md`. Delete them on that date; the list never grows.
- Every commit that touches a lockfile summarizes the lockfile changes in its message: direct dependencies added, removed or changed, and notable transitive changes.

**3. Release integrity.** Release builds run in CI from a clean checkout with provenance, and Wyatt reviews the `backend.js` diff before each release.

## Repo layout

```text
CLAUDE.md, README.md
START-HERE.md           Wyatt's setup notes (local only, gitignored)
.claude/settings.json   permission rules (deny wallet, key and spec edits; ask before push, publish, tags)
.mcp.json               emdash-docs MCP server
docs/                   spec, decisions, phases, progress, spec changes, references, proof of concept
spikes/                 throwaway spike code (phase 01), never shipped
plugin/                 the sandboxed EmDash plugin, slug xmr-pay (phase 02), pnpm + @emdash-cms/plugin-cli
bridge/                 Go module for xmr-bridge (phase 03)
installer/              install.sh and the systemd unit (phase 03)
theme/                  Astro components: pay button and /pay page (phase 06)
contract/               payment contract doc and conformance tests (phase 08)
scripts/                dev helpers (no secrets)
```

Each JavaScript package (`plugin/`, `theme/`, `contract/`) is a standalone pnpm project; there is no root workspace.

## Working with Wyatt's PC

Wyatt works from Windows over SSH and can't paste into Claude Code, in either direction. Files go back and forth with `scp` through `~/xmr-pay-dev-data/` (outside the repo, because outputs can hold IP addresses and other personal details).

**One-time setup on the PC** (any machine, any address). Add an SSH alias so every command below is the same everywhere. In PowerShell, open the SSH config:

```powershell
notepad "$env:USERPROFILE\.ssh\config"
```

Add these three lines, put the dev box's address in place of `REPLACE_WITH_DEV_BOX_ADDRESS` (Wyatt's is in `docs/dev-environment.md`), and save:

```text
Host xmr-dev
    HostName REPLACE_WITH_DEV_BOX_ADDRESS
    User dev
```

Check it with `ssh xmr-dev whoami`, which should print `dev`. Until the alias is set up, every command below fails with "Could not resolve hostname xmr-dev", so a missing step can't send anything to the wrong machine.

**For a step on Wyatt's PC**, Claude writes one PowerShell script to `~/xmr-pay-dev-data/<name>.ps1` that writes its results to `<name>-output.txt` next to itself (see `q2.ps1` from phase 01), and gives Wyatt exactly these three commands:

```powershell
scp xmr-dev:xmr-pay-dev-data/<name>.ps1 .
```
```powershell
powershell -ExecutionPolicy Bypass -File .\<name>.ps1
```
```powershell
scp .\<name>-output.txt xmr-dev:xmr-pay-dev-data/
```

Fill in `<name>` before handing the commands over. `-ExecutionPolicy Bypass` applies to that one run only (Windows blocks unsigned scripts by default). Claude then reads `~/xmr-pay-dev-data/<name>-output.txt`, and redacts IP addresses, locations, user names and tokens before any of it goes into the repo.

**For a step on the dev box that needs Wyatt** (`sudo`, or anything in his own tmux window), give one command that saves its own output, for example `sudo systemctl status monerod-stagenet 2>&1 | tee ~/xmr-pay-dev-data/<name>-output.txt`, then read that file.

**SSH tunnels** use the same alias: `ssh -N -L 4321:localhost:4321 xmr-dev` for the dev site (then http://localhost:4321 on the PC), and `ssh -N -L 4322:127.0.0.1:4322 xmr-dev` for the built copy. Leave the window open while it's needed.

## Memory: this box has limited RAM

The dev box has 8 GB of physical RAM (about 7.8 GB usable) and 512 MB of swap, and **8 GB is the maximum: it cannot be raised again.** It ran out of memory during phase 01 and had to be recovered by hand. `monerod` (about 1.4 GB) and `astro dev` (about 1.4 GB) alone take a third of it.

- **One heavy process at a time:** installs, test suites, builds, dev servers, `monero-wallet-rpc`, regtest `monerod`. Never chain several in one command; run one, check the result, then the next.
- **Check `free -m` before starting one.** If the `available` column is under 1.5 GB, stop something first. `scripts/check-env.sh` warns under 1 GB.
- **Stop the dev site and the built copy when a step doesn't need them.**
  - Dev site started by Claude: astro detects an AI agent and runs `astro dev` in the background, outside tmux, so `tmux kill-session -t site` does **not** stop it. Use `cd ~/sites/xmr-dev-site && npx astro dev stop` (also `npx astro dev status` and `npx astro dev logs`).
  - Dev site started by Wyatt from his terminal (foreground in tmux): `tmux kill-session -t site`.
  - Built copy: `tmux kill-session -t built`.
  - Either way, confirm with `ss -ltn | grep -E ':432[12]'` that the port is free.
- **Run vitest with a single worker:** `maxWorkers: 1` in each package's `vitest.config.ts` (or `--maxWorkers=1` on the command line).

## Commands

| Task | Command |
| --- | --- |
| Environment check | `scripts/check-env.sh` |
| Plugin tests | `cd plugin && pnpm test` |
| Plugin checks | `cd plugin && pnpm run typecheck && pnpm exec emdash-plugin validate && pnpm exec emdash-plugin bundle --validate-only` |
| Bridge tests | `cd bridge && go vet ./... && go test ./...` |
| Dev site | `~/sites/xmr-dev-site` on port 4321, answering on `localhost` (IPv6 `::1`), not `127.0.0.1`. Start: `tmux new -d -s site -c ~/sites/xmr-dev-site 'npm run dev; exec bash'`. When Claude starts it, astro moves itself to the background (outside tmux): stop it with `npx astro dev stop` in the site folder, check it with `npx astro dev status`, read its log with `npx astro dev logs`. When Wyatt starts it, it stays in tmux: stop it with `tmux kill-session -t site`. Wyatt views it through an SSH tunnel. Stop it when a step doesn't need it (see "Memory"). |
| Built copy of the dev site | `npm run build` in the dev site, then tmux session `built` on port 4322 (workerd runner; the only thing the public test hostname may point at) |
| Stagenet node | `systemctl is-active monerod-stagenet`; JSON-RPC at `http://127.0.0.1:38081/json_rpc` |
| Shop wallet details for a program | `scripts/with-shop-env.sh <command>` |
| Dev-site products (collection and three test products) | With the site stopped, in `~/sites/xmr-dev-site`: `npx emdash seed ../../xmr-pay/scripts/dev-products.seed.json --on-conflict skip` (`--validate` for a dry run). No login needed; safe to re-run |
| Plugin build for the dev site | `cd plugin && pnpm run build` (the site imports `plugin/` through `npm install file:../../xmr-pay/plugin` and `sandboxed: [xmrPay]`) |

Fill in or correct this table as phases add commands.
