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
