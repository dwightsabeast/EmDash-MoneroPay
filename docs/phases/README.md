# Build phases

Ten phases, in order. Each ends in something that runs. A phase may take several Claude Code sessions; `docs/progress.md` carries the thread between them.

| Phase | File | Ends with | Wyatt needed for |
| --- | --- | --- | --- |
| 00 | `00-repo-bootstrap.md` | Kit committed to `dwightsabeast/EmDash-MoneroPay`, tools checked, license chosen, pushed | Deploy key and clone (START-HERE), license choice, approving the push |
| 01 | `01-spike.md` | `docs/spike-findings.md` answers the platform questions; go or no-go for the design | A public test hostname (built site behind Cloudflare Access); a few commands from your PC; one time-locked stagenet payment sent by hand |
| 02 | `02-plugin-core.md` | Plugin with checkout, status, signed sync, pairing, state machine and cron, all tested, running in the dev site | Publisher placeholder or a real Atmosphere DID; price-API check |
| 03 | `03-bridge-and-installer.md` | Go bridge and `install.sh`; a real stagenet payment settles end to end | Release-signing and GPG-verification choices; running the installer with `sudo`; stagenet payments by hand |
| 04 | `04-admin-page.md` | Block Kit admin page and dashboard widget | Looking at the page in a browser |
| 05 | `05-setup-test.md` | A timed fresh install on a separate machine, under 15 minutes | A second container, a tester, a remote stagenet node |
| 06 | `06-theme-kit.md` | Pay button and `/pay` page as Astro components | npm package name and account |
| 07 | `07-tip-mode.md` | Tips with open amounts, notes and per-entry totals | Small UI choices |
| 08 | `08-store-adapter.md` | `kind: "order"`, the payment contract doc and tests, a DashCommerce adapter draft | Posting upstream |
| 09 | `09-release.md` | Signed releases, registry listing, install script live, mainnet tips trial | Atmosphere account, offline signing key, DNS, live-site go-ahead |

## Running a phase

1. SSH into the dev box, `tmux attach -t claude` (or `tmux new -s claude`), `cd ~/xmr-pay`, run `claude`. Sessions start in plan mode.
2. Paste the line from the phase file's "Start the session" box.
3. Read the plan. Answer its questions. Approve it (or ask for changes).
4. Let it work. It asks before anything on the "stop and ask" list in `CLAUDE.md`.
5. At the end, it appends to `docs/progress.md`. Check the tests it reports.

To resume a phase in a new session: `Continue phase NN. Read docs/progress.md for where we stopped, then plan the next step.`

Between phases, `/clear` (or a fresh `claude`) keeps the context small. Phases 02 and 03 are the big ones; their files suggest how to split them across sessions.

## When something goes wrong

- Tests red and Claude is going in circles: stop it (Esc), ask it to summarize what it tried in `docs/progress.md`, and start a fresh session on that problem alone.
- It wants to change the design: that goes in `docs/spec-changes.md`, then you decide.
- A bad change got committed: `git log` and `git revert <commit>`; nothing is pushed without your approval.
- The dev box is in a bad state: roll back the Proxmox snapshot `clean-setup` (you lose uncommitted work; pushed commits are safe on GitHub).
