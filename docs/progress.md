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
