# Decisions

Made by Wyatt between Sep 30 and Oct 1, 2026, before any code was written. The reasoning for each is in `docs/spec.md`. Don't reopen these unless Wyatt asks; if one turns out to be impossible, write it up in `docs/spec-changes.md`.

## Design

| Decision | Short reason |
| --- | --- |
| The bridge pushes in; the plugin never calls the wallet | Keeps the plugin's network grant to two fixed price hosts instead of unrestricted access |
| No keys in the plugin; a view-only wallet sits on the bridge side | Plugin KV is not encrypted; a database leak must expose no wallet material |
| Ed25519 public key in the plugin, not a shared secret | Nothing sensitive at rest. HMAC is a fallback only if the spike proves Ed25519 unavailable, and only with Wyatt's approval |
| Pre-created address pool, one subaddress per invoice, never reused | Invoice creation needs no wallet call; each payment maps to one invoice |
| Snapshots, not deltas | Retries, replays, reorgs and dropped transactions all resolve by overwriting |
| The theme owns the public UI | Sandboxed plugins can't inject scripts or serve HTML |
| Expire on evidence; judge lateness from wallet and chain data | A bridge outage must not turn on-time payments into late ones |
| Confirmations locked at checkout; admins can raise, never lower | Settings changes must not move the target on open invoices |
| Settled invoices stay watched until 10 confirmations deep | A reorg after settling must be seen; re-mined payments re-confirm quietly, vanished ones go to review |
| Time-locked and double-spend-flagged transfers never count | Coins the shop can't spend are not payment |
| Pairing with a one-time code | No required settings; rebuilding the wallet host is one button and one command |
| A generic payment contract (create, get, five statuses, no webhooks, no shared secret) | xmr-pay should work with any EmDash store and be the pattern other payment methods copy |

## Admin experience

| Decision | Short reason |
| --- | --- |
| Admin simplicity is a requirement with a hard budget (under 15 minutes, no required settings, one command, no upkeep) | Wyatt: "If this is overly cumbersome to set up and maintain, nobody will want to continue using it." |
| No Docker requirement | Most EmDash admins don't run Docker |
| No monero-ts or other single-maintainer wallet library | Supply-chain and maintenance risk for money-handling code |
| A small Go bridge that downloads, verifies and supervises Monero's official `monero-wallet-rpc` | The only code this project maintains is the bridge; the wallet work is Monero's own |
| One pasted install command that sets up a systemd service | The Cloudflare Tunnel connector pattern: copy, paste, done |
| A dedicated shop wallet | A view key can't be changed; a shop-only wallet limits any leak to shop income |
| The wallet host must be a separate machine from the site; no in-plugin "quick setup" mode | Keeps the shop's payment history off the site's server. The installer refuses to run beside a site, except with a stagenet-only dev flag |
| Own `monerod` recommended; a remote node allowed | Own node is the most private and secure; remote nodes get a block-hash cross-check |
| Linux only at launch | One platform to test and support; macOS and Windows later |

## Project and process

| Decision | Short reason |
| --- | --- |
| Build and test fully before publishing; the Atmosphere account comes at release | Config-managed installs (`sandboxed: [...]`) work without the registry |
| Develop on a separate Debian 12 container | Wyatt's live EmDash site at wyattdilley.com must stay untouched |
| Host the install script on a subdomain of wyattdilley.com (for example `get.wyattdilley.com`) | Without touching the live site |
| The release signing key is generated offline by Wyatt and never handled by Claude | Whoever holds it can push code to every wallet host |
| Build with Claude Code, one phase per session, plan first, tests first | Small reviewable steps |
| License: MIT, copyright Wyatt Dilley (phase 00) | Matches EmDash and DashCommerce; easiest for others to adopt |
| Repository public from phase 00 | Automated EmDash releases need a public repo; nothing private is committed |
| Dependency tiers (2026-10-03): shipped code (plugin bundle, bridge, installer, theme components) has no third-party runtime code (plugin: our code plus at most EmDash's own plugin helpers, hand-written validation, Block Kit as plain JSON; bridge: Go standard library, any exception decided in phase 03; installer: POSIX sh; theme: no runtime npm packages, a QR encoder vendored as reviewed source). Dev tooling is limited to EmDash's own toolchain, with exact pins, committed lockfiles, an install-script allowlist, a 7-day minimum release age and a lockfile summary in every commit that touches one. Release builds run in CI from a clean checkout with provenance; Wyatt reviews the `backend.js` diff before each release. Details in `CLAUDE.md`, "Dependency tiers" | Every line of shipped code is code we vouch for to every shop that installs it, in software that handles money. Fewer suppliers means fewer ways in, and what remains is pinned, aged, reviewable and built reproducibly |
| Regtest for fast local chain tests: No, for now (2026-10-03, phase 01) | The dev box can't run a second `monerod` (8 GB RAM at most). Chain scenarios (reorg, double-spend) stay covered by the plugin-side scenario tests and the stagenet end-to-end run, as phase 03 allows |
| Price sources: Kraken's public Ticker first, CoinGecko's keyless API as the fallback; USD and EUR only, GBP left out for now (2026-10-03, phase 02, spec change 8) | Both work without a key or a setting; CoinGecko discourages keyless use in production and its free key needs an account and a visible attribution; Kraken has no XMR/GBP pair |
| CI hardening (2026-10-03, phase 02): read-only `GITHUB_TOKEN` (`contents: read`), no `pull_request_target`, `persist-credentials: false`, `pnpm install --frozen-lockfile`, no dependency cache; only GitHub's own actions (`actions/checkout`, `actions/setup-node`) pinned to commit SHAs; pnpm from Node's corepack at the `packageManager` version | A pull request from a fork can't get a write token or secrets, nothing a job installs can push, and CI installs exactly the reviewed lockfile |
| How the bridge checks Monero's signed `hashes.txt` (2026-10-04, phase 03, spec revision 70, Bridge service): its own minimal OpenPGP verifier, Go standard library only (`crypto/rsa`, `crypto/sha256`). It accepts exactly one cleartext-signed `hashes.txt` with one v4 signature from the pinned Monero release key (binaryFate; the key's algorithm is confirmed before the code is written), SHA-256 or SHA-512 only with a matching `Hash:` header, and refuses everything else. Hashes are parsed only from the verified, canonicalized bytes. Only acceptable with fuzzing (no generated input ever verifies), a tampered corpus, and `gpgv` and ProtonMail `go-crypto` as differential oracles in CI only, never compiled into the shipped bridge. An unknown signing key makes the bridge keep its current wallet program and turn a health check red (update the bridge); a new Monero key arrives through a signed bridge update. Rejected: `go-crypto` in the bridge (a full OpenPGP library for one use, third-party code beside the view key, breaks the standard-library rule) and the system's `gpgv` (not on every Linux, breaks the one-command install) | Keeps both the bridge's standard-library rule and the admin's "no software to install first" budget, with the smallest attack surface: one format, one pinned key |
| The bridge's own release signatures (2026-10-04, phase 03 plan). What is signed: a `release.json` listing the version, the date, and each file's name, OS, CPU and SHA-256; the signature is Ed25519 (`crypto/ed25519`) over `"xmr-bridge-release-v1\n"` plus its exact bytes. Keys: up to two release public keys (current and next) pinned in the bridge; a release signed with the old key ships a new key list. Downgrade: a version not newer than the running one is refused. Staged delay: an update installs only once its manifest is at least 48 hours old (a constant). Rollback: the previous binary is kept and restored if the new one fails its health check. Installer: `install.sh` carries that release's bridge SHA-256s and checks them with `sha256sum`. Signing tool: Wyatt signs offline with any raw Ed25519 tool; which one is decided in phase 09 | Format we control, so no OpenPGP: one small primitive from the standard library. The prefix keeps release signatures apart from sync signatures, and the delay gives time to pull a bad release before it reaches every install (open question 16) |
| Dev release mode (2026-10-04, phase 03 plan): a `devrelease` Go build tag pins a throwaway public key from `~/xmr-pay-devkeys/` (passed in at build time, never committed), and `--release-url` is accepted only on stagenet. Release builds contain neither; phase 09 checks the release binary for both | The install and update paths can be tested before the real key and release host exist, without anything dev-only reaching a release |
| CI for the bridge (2026-10-04, phase 03 plan): a Go job with `actions/setup-go` (GitHub's own action, pinned to a commit SHA, Go 1.27.1, cache off), under the same hardening as the plugin job. ProtonMail `go-crypto` (BSD-3) is allowed only in the separate test module `bridge/oracle/` for the CI comparison checks, with exact versions and a committed `go.sum`. Its dependencies are approved for that module only: `cloudflare/circl`, and (approved by Wyatt in 3b-1) `golang.org/x/crypto` and `golang.org/x/sys`, the Go team's own (BSD-3). The comparison rule is spec change 10 (accepted, strict) | Revision 70 puts the verifier's comparison checks in CI; a separate module keeps the bridge's own `go.mod` dependency-free |
| Dev-site end-to-end shortcut (2026-10-03, phase 02): `scripts/dev-e2e.mjs` writes a pairing code's hash straight into the dev site's database instead of reading one from the admin page; dev only, loopback sites only, no plugin change. Wyatt also pairs once by hand from the admin page | The admin page stores only a hash, so a script can't read the code back; the hand run covers the real path |

## Still to decide (Wyatt)

| Question | When |
| --- | --- |
| The manual step behind the unpaid-address gap warning (spec change 9): how an admin raises the wallet app's subaddress lookahead (which apps allow it, and the exact steps), and whether that occasional step fits the admin budget or the feature must change | After phase 03's stagenet test, before phase 04 |
| npm package name for the theme components (needs an npm account to publish) | Phase 06 |
| Hosted bridge service: optional, paid, run by Wyatt, never the default; no keys in plaintext; one bridge per shop or a shared one. Pricing direction (Wyatt, 2026-10-03): tiers by monthly checkouts, with soft limits (going over doesn't cut a shop off); the plugin stays tier-free (it never knows or enforces a tier; the tiers live only in the hosted service) | After phase 05 (current phases unchanged) |
