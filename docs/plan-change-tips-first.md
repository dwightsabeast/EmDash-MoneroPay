# Plan change: tips-first release, with adversarial testing

Decided by Wyatt on Oct 13, 2026.

This file has two parts. Part 1 changes the phase plan. Part 2 is the adversarial testing phase, split into two passes to match it. Part 2 replaces the Oct 12 draft `08b-adversarial-testing.md`, which never reached the repo.

## How to fold this in

1. Log Part 1 as the next spec change in `docs/spec-changes.md`, and update the table in `docs/phases/README.md` (suggested rows below).
2. Save Part 2 as `docs/phases/07b-adversarial-testing.md`. One file covers both passes: pass 1 is phase 07b, pass 2 is phase 08b, and the README row for 08b points to the same file. Propose a different layout if it fits the repo better.
3. Propose every edit and show the diff before committing. Ask before pushing, per the CLAUDE.md rule.
4. None of this interrupts phase 05. It only changes what comes after it.

---

# Part 1: Plan change

## The decision

Coffer ships in two releases.

- **Release 1: tips only.** A registry listing plus a mainnet tips trial. No order or product checkout.
- **Release 2: orders.** The store contract and first store adapter (phase 08), the second adversarial pass (phase 08b), then an orders release.

## Why

- Get Coffer onto the EmDash plugin registry sooner. Two Stripe-based payment plugins and a commerce plugin are already listed there.
- Nothing is fulfilled on a tip, so a tips-only release carries far less risk than selling goods.
- Nothing reaches mainnet without an adversarial pass first, and goods still don't ship without a pass that covers them.

## New phase order

### Release 1

| Phase | Change |
| --- | --- |
| 05 Timed setup test | Unchanged. The confirmed test payment is a test tip. |
| 06 Theme kit | Scope to what tips need: the pay page and the button tips use. Defer order-only pieces to release 2. |
| 07 Tip mode | Unchanged, including the Oct 12 decision that tips stay open while the node or wallet host is syncing or silent (spec change 20 item 5, option 1). |
| 07b Adversarial testing, pass 1 (new) | Part 2, pass 1. A fresh attacker session that didn't write the code attacks everything a tips-only install exposes, and proves no order path is reachable. |
| 09 Release 1 | Security review starting from pass 1's findings, offline release-signing key, install host, registry listing, mainnet tips trial. Publish the security report, scoped to tips. |

### Release 2

| Phase | Change |
| --- | --- |
| 08 Store adapter | Content unchanged. Talk to store plugins early (Otta discussion #406, DinkusKit) so the contract fits their payment hooks. Design input: DinkusKit allows only one active payment provider per store. |
| 08b Adversarial testing, pass 2 | Part 2, pass 2. Orders, products and the store adapter, plus a retest of pass 1's attacks on any code changed since. |
| 09b Release 2 | The orders release on the registry, with the security report regenerated to cover orders. |

### Suggested rows for `docs/phases/README.md`

| Phase | File | Ends with | Wyatt needed for |
| --- | --- | --- | --- |
| 07b | `07b-adversarial-testing.md` (pass 1) | The tips surface attacked by a fresh session; no Critical or High finding open; matrix updated | Approving the attack plan, stagenet payments by hand, `sudo` steps, ruling on findings |
| 08b | `07b-adversarial-testing.md` (pass 2) | Orders and the adapter attacked to the same bar | The same |
| 09b | `09-release.md` (release 2 section) | Orders release on the registry | Release go-ahead |

Rename these if the names clash with existing conventions.

## Questions to answer while planning

Propose an answer for each, then ask Wyatt before choosing.

1. **Keeping goods out of release 1.** List every non-tip path a release-1 install could reach: the product checkout from phase 02, any other `kind` value, routes, admin controls, theme components. Propose whether to leave them out of the build or ship them disabled. Pass 1 attacks whatever you choose (row A0 in Part 2).
2. **The trust contract.** Registry versions are immutable. EmDash's manifest docs say a broadened trust contract (`capabilities`, `allowedHosts`, `storage`) needs a new major version, and new routes or hooks need a minor version. Check whether orders will need anything release 1 doesn't declare. Propose whether release 1 declares it up front, or release 2 takes the version bump and the fresh admin consent that comes with it.
3. **Security report scope.** Release 1's published report covers tips. Mark order-only threats as "covered in release 2" rather than dropping them.
4. **Sidebar icon.** Each entry in the manifest's `admin.pages` takes an `icon` naming one of EmDash's built-in icons. Check which names the schema in `node_modules/@emdash-cms/plugin-cli/schemas/` accepts, say what Coffer's Monero payments page uses now, and propose a better fit if there is one.

## Listing assets (phase 09)

- Wyatt is making the registry icon by hand. Don't generate or draw one.
- Registry listing images are declared under `release.artifacts` in `emdash-plugin.jsonc`: `icon`, an optional `banner`, and up to eight `screenshots`. PNG, JPEG or WebP, 1 MiB max each.
- `bundle` packs a root-level `icon.png` and anything in `screenshots/` into the tarball, where they count toward the 128 KB per-file and 256 KB total caps. Keep declared listing images in another folder, such as `images/`. Check the bundle's size headroom before deciding whether to also pack a small `icon.png` (256×256 is the recommended size).
- Pin `publisher` to the Atmosphere account's DID, not its handle.

## Still waiting on Wyatt

- Before 07: spec change 18's spike decision.
- Before 07b: the security matrix in the repo as `docs/security-matrix.md`, and decisions on C01–C06 (or accepting that undecided candidates are only probed and reported).
- Before 09: the mainnet second-node list, the self-update admin copy question, an install host that serves the bridge files without redirects, and the Atmosphere account to publish under.
- Not blocking: the spec text for changes 20 and 21.

## Deferred, don't plan now

- A public demo site (stagenet payments and demo admin access): after release 1.
- The Otta gateway and other store adapters: release 2.

## Reference

- Manifest fields and trust contract: https://docs.emdashcms.com/plugins/creating-plugins/manifest/
- Bundling and publishing: https://docs.emdashcms.com/plugins/creating-plugins/publishing/

---

# Part 2: Adversarial testing (phases 07b and 08b)

**Goal:** attack a running Coffer the way a hostile visitor, a hostile network or someone holding a stolen key would, before each release's security review. Every attack is tagged with a matrix ID, so its result goes straight into the public security report.
**Spec sections:** Security model (all), API contracts, Invoice lifecycle rules, Bridge service, "What the sandbox does and does not guarantee".
**Matrix:** `docs/security-matrix.md`, every row: T01–T16, P01–P04, R01–R11, F01–F06, and C01–C06 where decided.

## Two passes

| Pass | Phase | Runs after | Covers |
| --- | --- | --- | --- |
| 1 | 07b | Phase 07, before release 1 | Everything a tips-only install exposes: tip checkout, status, pay page, admin, sync, pairing, bridge, installer, sandbox and data at rest. Also proves no order or product path is reachable. |
| 2 | 08b | Phase 08, before release 2 | Order and product checkout, the store adapter and payment contract, and a retest of pass 1's attacks on any code changed since. |

Every row in the attack catalog is tagged **1**, **2** or **1+2**. Each pass runs only its own rows.

**Done when (each pass):**

- Every T, P and F row in the pass's scope has at least one attack run against it, or is marked Doc only, or "pass 2", with a one-line reason.
- Every R row in scope has either an attack run in this pass or recorded evidence from 3h or phase 05 attached to it.
- No Critical or High finding is open.
- Each Medium finding is fixed, or Wyatt has accepted it in `docs/decisions.md`.
- A fresh attacker session has re-run every attack in the pass against the fixed code.
- The matrix's coverage column is updated from the results.

The release review (phase 09 after pass 1, 09b after pass 2) then starts from `docs/redteam-findings.md` and the updated matrix instead of from scratch.

## Why this phase exists

The release gate is a desk review: walk the threat table and point to a test. This phase is the active half. Something tries to break Coffer and records what happened.

The attacker is a fresh Claude Code session that didn't write the code. The model that built a feature tends to share its blind spots, so the attacker reads the spec's promises cold and tries to make each one false.

Pass 1 exists because tips reach mainnet first. Pass 2 keeps the rule that goods don't ship without an adversarial run that covers them.

## Roles

| Role | Who | Does | Never does |
| --- | --- | --- | --- |
| Builder | A normal session | Setup, harness helpers, fixes, regression tests, matrix updates | Grade its own fixes as final |
| Attacker | A fresh session, started with the attacker line below | Writes the attack plan, runs attacks, files findings | Fixes Coffer's code, or reads the builder's notes before its plan is written |
| Wyatt | You | Approves the plan, sends stagenet payments by hand, runs `sudo` steps, rules on findings | — |

Only one session runs at a time. The dev box has 8 GB of RAM, and attack runs are heavy.

## For Wyatt, before the first session of each pass

- [ ] **Pass 1:** phases 05–07 are done. **Pass 2:** phase 08 is done.
- [ ] The matrix is in the repo as `docs/security-matrix.md`. Export the Claude Doc "Coffer — Security Traceability Matrix" as Markdown and copy it over. If its first audit hasn't run yet, run that audit session first; the matrix's own instructions say how.
- [ ] Decide C01–C06 in `docs/spec-changes.md`, or accept that undecided candidates are only probed and reported, not fixed.
- [ ] Stagenet node synced, and the Feather buyer wallet on your PC holds **at least eight separate unlocked amounts** (lesson from 3h). Only a handful of attacks need real payments.
- [ ] Snapshot the dev box in Proxmox (`pre-redteam-1`, then `pre-redteam-2`). Floods and fuzzing can leave it in a bad state.

## Sessions

Each pass splits its work across sessions like this. Start each one fresh (`/clear`, or a new `claude`).

| # | Session | Role | Ends with |
| --- | --- | --- | --- |
| 1 | Setup | Builder | Harness helpers, fake servers, sandbox canary, data-at-rest scanner, baseline backup of `data.db`. Pass 2 reuses pass 1's helpers and adds what orders and the adapter need |
| 2 | Plan | Attacker | This pass's section of `docs/redteam-plan.md`, approved by Wyatt |
| 3 | Round 1, black box | Attacker | Attacks from the spec and matrix only; findings filed |
| 4 | Round 2, white box | Attacker (fresh again) | Reads the source looking for gaps between spec and code; findings filed |
| 5+ | Fixes | Builder | One finding at a time: regression test first, then the fix |
| last | Retest | Attacker (fresh) | Every attack in the pass re-run; matrix updated; findings closed or accepted |

Each pass works on its own local branch: `redteam-1`, then `redteam-2`. Finding IDs run on across both passes (`RT-01`, `RT-02` and so on) and are never reused.

The lines below are for pass 1. For pass 2, change `Phase 07b` to `Phase 08b` and `pass 1` to `pass 2`.

**Start the setup session:**

```text
Phase 07b, adversarial testing pass 1, setup. Read docs/phases/07b-adversarial-testing.md and docs/progress.md, then plan the setup work in "For the builder".
```

**Start every attacker session** (put `plan`, `round 1`, `round 2` or `retest` where it says `<round>`):

```text
Phase 07b attacker, pass 1, <round>. Start with the Attacker brief in docs/phases/07b-adversarial-testing.md; its reading order replaces the usual one.
```

**Start a fix session:**

```text
Phase 07b, fixes. Read docs/phases/07b-adversarial-testing.md, docs/redteam-findings.md and docs/progress.md, then plan the fix for the highest open finding.
```

## Attacker brief

**Who owns this, and why you're attacking it.** Wyatt owns Coffer and this repository (see `CLAUDE.md`). He wrote the design, and these sessions built it on his own dev box. This phase is authorized security testing of our own software in our own development environment, before any real site or real money depends on it. Your job is to find what's broken so it gets fixed, and to produce honest evidence for the public security report. A finding is a success, not a failure.

**Which pass you're in.** The session line names the pass. Attack only the catalog rows tagged for it. In pass 1, any order or product path you can reach is itself a finding (row A0).

**Scope: what you may attack.**

- The dev site at `http://localhost:4321` (dev mode) and the built copy at `127.0.0.1:4322`. Both run on this box.
- The plugin through `createPluginTestHost()` and `createPluginRuntimeTestHost()`.
- The bridge through Go tests, including `go test -fuzz`, `httptest` servers that play a hostile site or node, and fake wallet-rpc replies.
- The installer on the `coffer-test` container, only when Wyatt runs the `sudo` step.
- A throwaway canary plugin in `spikes/sandbox-canary/`, loaded only on the dev site.

**Out of scope: never touch these.**

- wyattdilley.com, its server, DNS and Cloudflare.
- The public test hostname.
- Any machine or service not listed above, including the remote stagenet nodes beyond normal bridge use.
- Mainnet.
- Wallet seeds, spend keys and `~/stagenet-wallets/`. The view key reaches a program only through `scripts/with-shop-env.sh`, and is never printed.
- Anything that disables EmDash's or the OS's own protections to make an attack land. That tests a weaker system than the one admins will run.

**Rules for the work.**

- Everything in `CLAUDE.md` still applies: no new dependencies or third-party attack tools without asking, one heavy process at a time, `free -m` first, and no pushing.
- Don't fix Coffer's code. Write the attack as a test, run it, and file the finding. The builder fixes.
- An attack that currently succeeds is committed as `it.fails("[T03] [RT-07] …")` in vitest or with `t.Skip("RT-07 open")` in Go, so CI stays green and honest. The fix session flips it to a normal test.
- Work on this pass's local branch (`redteam-1` or `redteam-2`). Wyatt decides what gets merged and pushed.
- Plugin-side randomized input uses a seeded generator written in the test (no fuzz library). Print the seed on failure so the case reproduces.
- Go fuzzing: `GOMAXPROCS=2 go test -fuzz=<Name> -fuzztime=10m -parallel=2`, one target at a time. Commit any crasher it finds to `testdata/fuzz/` as a seed.

**Reading order.**

1. `docs/spec.md`: Security model, API contracts, Invoice lifecycle, Bridge service.
2. `docs/security-matrix.md`. If it isn't in the repo, stop and tell Wyatt.
3. This file's attack catalog below, the rows for your pass.
4. **Plan round:** write this pass's section of `docs/redteam-plan.md`: for each matrix row in scope, the attacks you'll run, at which layer, and what result would count as a break. Add anything the catalog missed. Stop and show Wyatt. **Other rounds:** read the approved plan and `docs/redteam-findings.md`, then carry on with step 5.
5. Only after the plan is approved, read `docs/decisions.md`, `docs/spec-changes.md` and `docs/progress.md`. A result that matches a decision Wyatt already made is an Accepted limit, not a finding.
6. Round 1 stays black box: public routes and published behavior only. Round 2 reads the plan and round 1's findings, then `plugin/src/` and `bridge/`, looking for places the code does less than the spec says.

**Severity, by what actually happens to people.**

| Severity | Meaning |
| --- | --- |
| Critical | Money, including a tip, goes anywhere but the shop wallet; any key, view key, wallet-rpc login or plaintext pairing code leaks; anyone without the bridge key can make the plugin accept a sync |
| High | Goods released without a valid, confirmed payment and without a stolen key; in pass 1, a tip recorded as paid without a valid, confirmed payment and without a stolen key, because that is the same check orders will rely on; buyer or tipper contact data readable by someone other than the admin; a crash or hang that an anonymous request can trigger at will |
| Medium | Checkout outage by an anonymous attacker beyond the spec's stated limit; state left inconsistent after an error; a check the spec promises that is missing but not yet exploitable |
| Low | Internal details in error replies, wrong error codes, misleading admin text |
| Accepted limit | Behaves exactly as a design limit the spec or `docs/decisions.md` states. Recorded for the report, not fixed |

**Each finding in `docs/redteam-findings.md`** gets the following fields:

- An ID (`RT-01`, `RT-02` and so on) and the matrix IDs it touches.
- Severity, pass and round.
- What you did, as exact steps or a test name.
- What happened, and what the spec says should happen.
- Evidence: commit, layer, runner, and the test output or file in `~/xmr-pay-dev-data/redteam/`.
- Status: open, fixed in a commit, or accepted by Wyatt on a date.

Redact IPs, tokens and user names before anything goes into the repo.

## Attack catalog

The attacker's starting list, grouped by who is attacking. The plan session may add to it but shouldn't drop rows without saying why. A row marked "propose a row" has no matching matrix entry yet; the plan should propose one.

**A. Anonymous visitor: `checkout`, `status`, pay page**

| Attack | Matrix | Layer | Pass |
| --- | --- | --- | --- |
| **A0.** On a release-1 build, try `kind: "order"`, a product checkout, any order or adapter route, and any order control on the admin page. Each must be refused or absent | T06, F02 | Host, dev site | 1 |
| Send `amountAtomic`, `rate`, `currency` or `required` with a tip checkout (pass 1) or a product checkout (pass 2); switch `kind`; for products, reference a draft, unpublished or priceless product | T06, F02 | Host | 1+2 |
| Price API returns 0, negative, `NaN`, `1e308`, a 30-digit integer, HTML, a 500 or a slow reply; the rate changes mid-checkout | T06 | Host | 1+2 |
| Wrong types, unknown fields, 1 MB strings, bidi and zero-width characters, HTML and script in every buyer field: the tip note in pass 1, email and refund address in pass 2 if only orders collect them | F02, T08 | Host, Manual | 1+2 |
| Look at those fields on the admin page through the tunnel: do they render as plain text? | T08 | Manual (Wyatt) | 1+2 |
| Status with empty, malformed, 10 KB and well-formed unknown tokens: same generic reply, no stack trace, no internal ID | F03 | Host, dev site | 1 |
| Status and pay-page headers: `no-store`, `no-referrer`, `noindex`; no third-party requests from the page | T09 | dev site | 1 |
| Spoofed `Host` and `X-Forwarded-Host` on every public route | F06 | Runtime, dev site | 1 |
| Fill the open-invoice cap; with the bridge stopped, flood tips (tips stay open, so the pool can't refill) until the pool is empty. Nothing may reuse an address. In pass 2, orders must also still refuse correctly | T05, P02 | Host, dev site | 1+2 |
| 50 concurrent checkouts racing for the last free address | T05, P02 | Host, dev site | 1 |
| `returnUrl` pointing off-site, at `//evil.example`, `javascript:` or an encoded variant | C01 | Host | 1 |
| Tips below the dust floor, at it, and absurdly large | F02 | Host | 1 |
| Per-entry tip totals: tip a nonexistent, draft, trashed or private entry; tip with another entry's ID. Only settled tips may count toward a total; expired, underpaid, late and reversed tips never do | F02, T06 (propose a row) | Host | 1 |
| If tip notes or per-entry totals appear anywhere on the public site, check they render as plain text and leak nothing about other tippers | T08, P03 (propose a row) | dev site | 1 |
| A tip paid while the node is syncing or the bridge is silent (tips stay open by the Oct 12 decision) settles exactly once after the bridge returns | R06, T05 | E2E | 1 |
| Order spoofing: create a `kind: "order"` invoice with a real `orderRef` and a smaller `amountMinor`, pay it, and see whether the store adapter marks the real order paid | T06 | Host, dev site | 2 |

**B. A logged-in non-admin, or a request from another site: `admin`**

| Attack | Matrix | Layer | Pass |
| --- | --- | --- | --- |
| Call `admin` anonymously, as a logged-in user without `plugins:manage`, and without the `X-EmDash-Request` header | F04 | Runtime, dev site | 1 |
| Row actions on unknown invoice IDs; negative, zero or huge confirmations; lowering `required`; marking an expired or reversed invoice settled; issuing pairing codes in a tight loop | F04, T07, T13 | Host | 1 |
| Any order actions phase 08 adds to the admin page, attacked the same way | F04, T07 | Host | 2 |

**C. Someone who can reach `bridge/sync` but holds no key**

| Attack | Matrix | Layer | Pass |
| --- | --- | --- | --- |
| No signature, a garbage signature, the right signature over different bytes, a valid signature from an unpaired key, a signature with one bit flipped | T03 | Host, Runtime | 1 |
| Timestamps at 299 s and 301 s, past and future; the same signed body twice; `seq` equal to, below and far above the last accepted | T04 | Runtime | 1 |
| Random bytes, invalid UTF-8, a byte-order mark, truncated JSON, duplicate keys, unknown fields, `v: 0` and `v: 99`, amounts that are negative, decimal, exponent or above 2^64−1, a 33rd transfer, a body at `maxBytes` and one byte over | F01, T11 | Runtime (seeded random) | 1 |
| `Origin` and `Authorization` headers added, as a proxy might | T03 | dev site | 1 |
| A slow body that drips for 60 s: does the request die at the 30 s wall limit, and is the site still answering? | F01 | dev site | 1 |
| Pairing: a guessed code, an expired code, a used code, a `pair` field with no active code, a pair body over 4 KiB, a `pair` signed by a key other than the one in the body | T13 | Runtime | 1 |
| Two pair requests with the same valid code at the same moment: exactly one may win | T13 | dev site | 1 |

**D. Someone holding a stolen bridge key** (pair the RFC 8032 test key in the test host)

The spec says the worst case is free goods, not lost funds. For tips, the matching worst case is a fake tip shown as received. Map the exact blast radius so the report states it precisely.

| Attack | Matrix | Layer | Pass |
| --- | --- | --- | --- |
| Mark an open invoice settled with a forged snapshot (expected: works, and is the stated limit) | T03 | Host | 1+2 |
| Push new pool addresses the attacker controls. Do tippers (pass 1) or buyers (pass 2) then pay the attacker? If yes, the "free goods" wording is incomplete and the report must say so. Also try addresses that reuse an existing index or duplicate an address already held | T03, P02 | Host | 1+2 |
| Make a settled invoice look reversed, to flood the review queue; re-open an expired invoice; drop transfers from a snapshot | T03, T12 | Host | 1 |
| Shrink the watch list or confuse it with huge indexes | T03 | Host | 1 |
| Can a forged sync lower `required` or change any amount on an invoice? (expected: no) | T07 | Host | 1 |
| Inflate a per-entry tip total with forged settled tips. Record how far it goes; this is the tips version of "free goods" | T03 (propose a row) | Host | 1 |

**E. Hostile site or network, aimed at the bridge**

| Attack | Matrix | Layer | Pass |
| --- | --- | --- | --- |
| The site answers with `poolTop` near 2^32, a `poolTarget` of a billion, or a million-entry watch list. Does the bridge create millions of subaddresses or rescan forever? | F05 | Go (`httptest`) | 1 |
| A 100 MB reply, a reply that drips for minutes, a redirect to another host, a 401 or 403, the wrong content type, invalid JSON | F05 | Go | 1 |
| A self-signed or expired certificate on the site and on the release host | C03 | Go (`httptest.NewTLSServer`) | 1 |
| A dishonest node: lies about height, puts the txid in the wrong block, or the second node lies too; both nodes unreachable | T14 | Go | 1 |
| wallet-rpc replies with huge numbers, missing fields, negative amounts or a non-zero `unlock_time` | F05, T11 | Go | 1 |
| A double-spend flag set on a transfer that already counted | T11, T12 | Go, Host | 1 |

**F. Supply chain, install and the wallet host**

| Attack | Matrix | Layer | Pass |
| --- | --- | --- | --- |
| On `coffer-test` after an install: wallet-rpc listens only on 127.0.0.1 and refuses requests without its login; the bridge opens no port; over a few sync cycles, outbound connections go only to the site, the nodes and the release and download hosts (`ss -tlnp`, `ss -tnp`) | T10 | Install, Manual (Wyatt) | 1 |
| A bridge update with a bad signature, a validly signed older version (downgrade), and a truncated binary | T16, C02 | Go | 1 |
| A `hashes.txt` with a bad GPG signature or a mismatched hash for wallet-rpc | T16 | Go | 1 |
| A tampered `install.sh` served from the dev release server; the same-machine check bypassed by a flag on mainnet | T16, T15 | Install (Wyatt runs `sudo`) | 1 |
| `pnpm audit`, `govulncheck` (ask first), and a lockfile diff against the dependency tiers | C04 | CI | 1+2 |

**G. The sandbox itself**

| Attack | Matrix | Layer | Pass |
| --- | --- | --- | --- |
| A canary plugin in `spikes/sandbox-canary/`, with Coffer's exact manifest, tries raw `fetch()`, a host outside `allowedHosts`, `ctx.content.create`, another plugin's storage, `process.env` and a Node built-in import. Every one must fail | T01 | dev site | 1 |
| A canary route that spins the CPU: is it stopped at 30 s, and does the site keep answering checkout meanwhile? (The Node runner doesn't cap CPU; this measures what that costs) | T01, R11 | dev site | 1 |
| Coffer's manifest, routes and hosts compared with the spec in CI, so any drift fails the build | T01 | CI | 1+2 |

**H. Resource exhaustion on the Node runner**

| Attack | Matrix | Layer | Pass |
| --- | --- | --- | --- |
| Seed thousands of open and expired invoices, then time each sync. Each must finish under 30 s, and the backlog must drain over several syncs | R11 | Runtime, dev site | 1 |
| Ramp a checkout and status flood with Node's built-in `fetch`, capped at 50 concurrent: tips in pass 1, orders in pass 2. Record the rate at which the site stops answering, so the install docs can name a real rate-limit number | T05 | dev site | 1+2 |
| Stop any flood the moment `free -m` shows under 1.5 GB available | — | — | 1+2 |

**I. Data at rest** (after a full stagenet payment and a pairing)

| Attack | Matrix | Layer | Pass |
| --- | --- | --- | --- |
| Scan a `VACUUM INTO` copy of `data.db`, plugin KV and settings, and the astro logs for the view key, the plaintext pairing code and raw IPs. The scanner reads the view key only through `scripts/with-shop-env.sh` and prints PASS or FAIL with a location, never the value | T02, P01, P03 | E2E | 1+2 |
| The bridge's journal, the install transcript and the same database copy checked for the view key and the wallet-rpc login, run by Wyatt with `sudo`, output written to a file | C06, T02 | Manual | 1 |
| Fast-forward the clock past 30 days and confirm buyer fields are gone: the tip note in pass 1, email and refund address in pass 2 | P04 | Runtime | 1+2 |

**J. Failures at bad moments**

| Attack | Matrix | Layer | Pass |
| --- | --- | --- | --- |
| Kill the dev site in the middle of a sync, and the bridge in the middle of a POST; after restart, nothing is lost or counted twice | R05 | E2E | 1 |
| Set the bridge's clock 301 s fast, then 301 s slow: syncs are refused, and does the admin page say why? | C05, T04 | Runtime, dev site | 1 |
| A cron housekeeping run and a sync landing at the same moment; an admin row action landing during a sync | R05, T07 | Runtime | 1 |
| A payment that disappears before settlement | R10 | Host, Go (faked replies) | 1 |
| R06–R09 ran in 3h: attach that evidence instead of re-running, unless round 2 finds a reason to | R06–R09 | — | 1 |

**K. Real stagenet payments** (keep these few; Wyatt sends each one from Feather)

| Attack | Matrix | Layer | Pass |
| --- | --- | --- | --- |
| A normal payment first, as the control: a tip in pass 1, an order in pass 2 | R01 | E2E | 1+2 |
| No payment: the invoice expires and never settles | R02 | E2E | 1 |
| Underpay, then top up in time; underpay and let it expire | R04 | E2E | 1 if a tip invoice carries a fixed amount, otherwise 2 |
| Overpay: settles, and the excess is recorded | R04 | E2E | 1 if a tip invoice carries a fixed amount, otherwise 2 |
| Pay after expiry, inside the 24-hour window | R03 | E2E | 1 |
| Pay an expired invoice's address after its watch ends | R03 | E2E | 1 |
| One transaction paying two invoices at once (Feather's pay-to-many): both settle, each counted once, though they share a txid | R01, T07 | E2E | 1 |

Reorgs, reversed payments, time-locked and double-spend transfers can't be produced on stagenet on demand. They stay at the Host and Go layers with faked replies, and the report says so.

## For the builder

**Setup (session 1 of each pass)**

- Create the pass's branch (`redteam-1` or `redteam-2`). Back up `data.db` with `VACUUM INTO` to `~/xmr-pay-dev-data/redteam/baseline-<pass>.db`.
- Pass 1: pull the signed-request helper out of `scripts/dev-e2e.mjs` into `scripts/redteam/lib.mjs` so attacks can sign with the RFC 8032 test key or a pairing key. Loopback targets only: the helper refuses any other host.
- Pass 1: add `plugin/tests/redteam/` (picked up by the existing vitest config, `maxWorkers: 1`) and a seeded random input helper there.
- Pass 1: add Go test helpers for a hostile site, node and wallet-rpc on `httptest`, beside the packages they attack.
- Pass 1: build the sandbox canary in `spikes/sandbox-canary/`. It is never shipped, and it is loaded on the dev site only while its tests run.
- Pass 1: write the data-at-rest scanner as `scripts/redteam/scan-at-rest.mjs`. It runs under `scripts/with-shop-env.sh` and never prints a secret.
- Pass 2: reuse all of the above, and add whatever orders and the store adapter need (a fake store calling the payment contract, for example).
- Add the 07b and 08b rows to `docs/phases/README.md`. Add a line to step 1 of `docs/phases/09-release.md`: start from `docs/redteam-findings.md` and the updated matrix. Show Wyatt both edits.

**Fixes (sessions 5+)**

- One finding per step. Flip its `it.fails` or `t.Skip` to a normal test that now passes, tagged with the matrix ID and the RT ID, then fix the code.
- A fix that needs a change to the trust contract, a new setting, a dependency, or a spec change stops here. It goes to `docs/spec-changes.md` for Wyatt.
- Update the finding's status and the matrix row's coverage with the commit.

**Retest (last session of each pass):** a fresh attacker session re-runs every attack in the pass's section of `docs/redteam-plan.md` on the fixed code. Results go in `docs/redteam-findings.md` under "Retest, pass <n>", with commit and CI run.

## For Wyatt during each pass

- Approve the pass's section of `docs/redteam-plan.md` before round 1.
- Send the stagenet payments in section K by hand. The session gives you a file with each address and amount; send one per line and note the time.
- Run the `sudo` steps (journal scan, installer attacks); each one writes its own output file.
- Look at the admin page through the tunnel for the injection check.
- Rule on every Medium finding and every Accepted limit.
- Decide afterward whether an outside review is still wanted before mainnet. This phase doesn't replace one.

**Stop points:** any change to the trust contract (`capabilities`, `allowedHosts`, routes, storage); any dependency or outside tool; any target not in the attacker's scope; any `sudo` step; pushing or merging a `redteam` branch.

**Out of scope:** the live site, mainnet, and attacks on EmDash or Monero themselves. If an attack turns up a bug in EmDash or Monero rather than in Coffer, write it up for Wyatt to report upstream, and don't probe further.
