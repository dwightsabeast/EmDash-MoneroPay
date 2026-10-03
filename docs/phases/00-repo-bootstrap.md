# Phase 00 — Repo bootstrap

**Goal:** the kit committed to the existing GitHub repository (`dwightsabeast/EmDash-MoneroPay`), with the toolchain checked and the project's ground rules in place.
**Done when:** the first commit is on GitHub, `scripts/check-env.sh` passes (the node may still be syncing), and `docs/dev-environment.md` records exact tool versions.

## For Wyatt, before the session

- [ ] `START-HERE.md` steps 1–4 are done: the deploy key works, the repo is cloned to `~/xmr-pay` with the kit copied in, and git knows who you are.
- [ ] A 30-second check, **as `dev`** (the prompt reads `dev@debian-emdash-test:~$`): `whoami` prints `dev`; `git config --global --get-regexp '^user\.'` shows your real name and noreply address, not a placeholder; `ssh -T git@github.com` greets `dwightsabeast/EmDash-MoneroPay`; `ls ~/sites` lists `xmr-dev-site`. If anything is off, START-HERE's "If a step fails" table has the fix.
- [ ] Start Claude Code from that same `dev` prompt, inside `~/xmr-pay`. Never as root.
- [ ] Decide whether the repository is public now or at release. Public is recommended eventually: EmDash's automated releases require it.
- [ ] Have a license in mind. MIT matches EmDash and DashCommerce and is the easiest for others to adopt; Apache-2.0 adds a patent grant; GPL-3.0 keeps derivatives open.

**Start the session** (paste into Claude Code):

```text
Phase 00. Read docs/phases/00-repo-bootstrap.md and docs/progress.md, then give me your plan.
```

## For Claude

**Read first:** `CLAUDE.md`, `docs/decisions.md`, `docs/dev-environment.md`.

**Tasks**

0. **Preflight.** Before anything else, confirm each of these and stop at the first failure with the fix from the "If a step fails" table in `START-HERE.md`:
    - `whoami` is `dev`, and `pwd` is `/home/dev/xmr-pay`.
    - `git config user.name` and `git config user.email` are set and aren't placeholders (`Your Name`, anything with `REPLACE`, or an email starting `ID+`).
    - `git ls-remote origin` succeeds. That proves the deploy key works without you running `ssh`.
    - `/home/dev/sites/xmr-dev-site` exists and is owned by `dev`.
    - `.claude/settings.json` and `.mcp.json` exist (moved from `kit-setup/` in START-HERE step 2.5), and `kit-setup/` is gone.
1. Run `chmod +x scripts/*.sh` (the copy from Windows drops the executable bit), then `scripts/check-env.sh`, and report the results. If the stagenet node is still syncing, note its height; that is fine for this phase.
2. Record exact versions (Node, pnpm, Go, git, Monero CLI, workerd in the dev site, Claude Code) in the Toolchain table of `docs/dev-environment.md`.
3. Ask Wyatt for the license and the copyright holder's name. Add `LICENSE` with the full standard text for the chosen SPDX id.
4. Write `README.md` for the public repo: what xmr-pay is (three sentences), status ("in development, not ready for use"), the security model in five bullets (from the spec's Security model), and the layout. No personal or dev-box details.
5. Do not create `plugin/`, `bridge/` or the other code folders yet; later phases scaffold them with their own tools.
6. The repo is already a clone with one commit (`.gitattributes`, which normalizes line endings; keep it). Check that `git remote -v` uses the SSH URL `git@github.com:dwightsabeast/EmDash-MoneroPay.git`, that `.gitignore` covers everything in it, and commit the kit. `START-HERE.md` and `docs/dev-environment.md` are deliberately gitignored (they describe Wyatt's home network) and must not be staged. Check that nothing secret or personal is staged (`git status`, `git diff --cached --stat`, and a grep of the staged files for the LAN address and any key-like strings).
7. Ask Wyatt before `git push`.
8. Confirm the `emdash-docs` MCP server answers (`/mcp` shows it; try one `search_docs` query such as "sandboxed plugin routes"). If Wyatt hasn't approved it yet, ask him to.
9. Append a session entry to `docs/progress.md`. If any setup step tripped (in preflight, or anything Wyatt mentions), add a row to `docs/setup-friction.md`. Commit both.

**Stop points:** the license choice and the push.

**Out of scope:** any plugin or bridge code; CI (phase 02 adds it).
