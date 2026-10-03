# Progress log

Newest entry at the bottom. Each session appends one entry:

```text
## YYYY-MM-DD · Phase NN · short title
Done:
Tests: (commands run and results)
Open issues:
Next step:
```

## 2026-10-01 · Starter kit

Done: Starter kit assembled outside Claude Code: spec snapshot, decisions, ground rules, phase prompts, proof of concept, EmDash reference. Dev box set up per the runbook (stagenet node syncing, dev site running).
Tests: none yet.
Open issues: license and repository visibility to choose in phase 00. The repository exists (`dwightsabeast/EmDash-MoneroPay`, one commit with `.gitattributes`).
Next step: Phase 00, `docs/phases/00-repo-bootstrap.md`.

## 2026-10-02 · Phase 00 · Repo bootstrap

Done: Preflight passed (user `dev`, real noreply git identity, `git ls-remote origin` OK over SSH, dev site owned by `dev`, `kit-setup/` gone). Scripts made executable. Exact tool versions recorded in `docs/dev-environment.md` (local only). Wyatt chose MIT (copyright Wyatt Dilley) and a public repository from now; both recorded in `docs/decisions.md`. Added `LICENSE` and a public `README.md`. Removed the dev box's LAN address from `docs/phases/05-setup-test.md` (it now points to `docs/dev-environment.md`). Committed the kit after a staged-file scan (no LAN address, no key-like strings, local-only files not staged). `emdash-docs` MCP answers `search_docs`.
Tests: `scripts/check-env.sh`: all `[ok]`. Node v24.21.0, pnpm 12.8.1, Go 1.27.1, git 2.47.3, jq 1.7, Claude Code 2.1.288, Monero v0.18.5.1, `monerod-stagenet` active and synced at height 2220727, `stagenet.env` mode 600, workerd 2026-10-02, sandboxRunner configured, dev site answering on localhost:4321. No code tests yet (no code).
Open issues: The spec's manifest still reads `<SPDX id>`. Wyatt to set it to `MIT` in the live spec and refresh `docs/spec.md`. The repo's initial commit (`bd94c9e`) carries Wyatt's personal email; Wyatt chose not to rewrite history and turned on GitHub's email privacy settings instead. Wyatt switches the repository to public on GitHub himself.
Pushed: `bd94c9e..242f82e` to `origin/main`, with Wyatt's approval; `git ls-remote origin` matched local HEAD.
Next step: Phase 01, `docs/phases/01-spike.md`.

## 2026-10-03 · Phase 01 · Reminder: delete the release-age excludes on 2026-10-08

Done: `spikes/xmr-spike/` installed with `minimumReleaseAge: 10080` (7 days) and 12 exact-version `minimumReleaseAgeExclude` entries for the EmDash 1.1.0 release (published 2026-10-01), approved by Wyatt: `emdash@1.1.0`, `@emdash-cms/blocks@1.1.0`, `plugin-types@0.5.0`, `plugin-test@0.2.7`, `plugin-cli@0.13.2`, `cloudflare@1.1.0`, `admin@1.1.0`, `auth@1.1.0`, `gutenberg-to-portable-text@1.1.0`, `registry-client@0.7.0`, `registry-lexicons@0.7.0`, `registry-verification@0.3.3`. Nine match `~/sites/xmr-dev-site/package-lock.json` exactly; `plugin-test`, `plugin-cli` and `cloudflare` aren't in the site and were accepted on provenance (same release commit `913cb1bb9b7f` of `emdash-cms/emdash` as the site's `emdash@1.1.0`). All 12 carry verified registry signatures and SLSA v1 provenance from `emdash-cms/emdash` `.github/workflows/release.yml`; `npm audit signatures` in the dev site: 698 verified signatures, 253 verified attestations, none invalid or missing.
Tests: `pnpm install` (clean) and the scaffold's `pnpm test` (1 passed).
Open issues: none for this item.
Next step: **On or after 2026-10-08**, delete the whole `minimumReleaseAgeExclude` block from `spikes/xmr-spike/pnpm-workspace.yaml` (and from any other package that copied it), run `pnpm install`, confirm it succeeds and `pnpm-lock.yaml` doesn't change, and commit, noting it in that day's entry. The exception list never grows.

## 2026-10-03 · Phase 01 · Spike

Done: Spike plugin `spikes/xmr-spike/` (slug `xmr-spike`, fake publisher DID) and `spikes/wallet/`, with dependency guardrails (exact pins, install-script allowlist, 7-day release age with 12 dated EmDash excludes). `docs/spike-findings.md` has a verdict and evidence for every question, plus recommendations. Gates: Q1 Ed25519 pass in the test host, `astro dev` and the built workerd server; Q2 no-`Origin` POST pass through the SSH tunnel and `dev.wyattdilley.com` behind Cloudflare Access; Q3 per-minute cron accurate (16/16 runs, 12–55 ms late; survives a restart), but config-managed plugins never get `plugin:install` or `plugin:activate` at startup. Q4: `ctx.settings` with encrypted secrets (secrets need `EMDASH_ENCRYPTION_KEY`, plain values don't). Q5: `requestMeta.ip` is `null` on Node unless trusted proxy headers are configured (then spoofable from outside Cloudflare). Q6: `updateIf` claims correct, concurrency not really exercised, PostgreSQL untested. Q7: `unlock_time` marks time locks, `locked` is the 10-block spendable age; time-locked sends are gone in Monero 0.18.5.1. Q8 skipped (Wyatt: no second `monerod` on this box). Q9: `backend.js` 4 KB. Spec changes: 1 accepted (bytes body, Wyatt's four bridge terms), 2–4 proposed. Also: `check-env.sh` nesting-depth check for `sandboxRunner` and a memory line; CLAUDE.md sections "Dependency tiers", "Working with Wyatt's PC" (SSH alias, scp a script and its output) and "Memory" (the box ran out of RAM; 8 GB is the maximum); decisions.md dependency-tiers row; phases 02/04/06 drop zod, `@emdash-cms/blocks` and QR packages; setup-friction rows for the misplaced `sandboxRunner`, the out-of-memory crash, astro's agent auto-background, and the PC command and output snags.
Tests: `cd spikes/xmr-spike && pnpm test`: manifest valid, 4 files, 21 tests passing; `tsc --noEmit` clean; `emdash-plugin bundle --validate-only` passed (9.5 KB across 3 files). Dev-site scripts: `send-vectors.mjs` all as expected on `astro dev` and the built server; `claim-race.mjs` 10/10 rounds on both; cron 15 min on `astro dev`, restart check, 5 min on the built server. `scripts/check-env.sh` all `[ok]` after cleanup. Not covered: real concurrent claims, PostgreSQL, a time-locked transfer, regtest, Cloudflare Workers limits.
Cleanup: dev site restored to the morning baseline (`astro.config.mjs`, `package.json`, `package-lock.json` byte-identical; `dist/` removed); the spike's 10 rows deleted from `data.db` (`_plugin_storage` 7, `_plugin_indexes` 2, `_emdash_cron_tasks` 1; backup in `~/xmr-pay-dev-data/baseline/data.db.before-spike-cleanup`); view-only wallet files and the wallet-rpc log deleted; dev site, built copy and wallet-rpc stopped. `~/xmr-pay-dev-data/q2-output-round{1,2}.txt` (Wyatt's unredacted IP) and `q2.ps1` are still there, local only.
Open issues: Wyatt to read `docs/spike-findings.md` (phase 01's "done when"), decide spec changes 2–4, and update the live spec and `docs/spec.md` (entry 1, plus the CLAUDE.md "raw bytes body" wording). Wyatt to remove the `dev.wyattdilley.com` hostname if not done. Delete the `minimumReleaseAgeExclude` list on or after 2026-10-08 (reminder above). The decisions.md "Still to decide" row on regtest stays open.
Next step: Wyatt reads the findings and decides spec changes 2–4; then Phase 02, `docs/phases/02-plugin-core.md`, session 2a.

