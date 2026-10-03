# Phase 01 — Spike: prove the platform assumptions

**Goal:** answer, with evidence, the questions the design rests on, before any real plugin code. This is the gate for everything else.
**Spec sections:** Build plan (step 1), Open questions 1–4, 6, 7, 11, API contracts (`bridge/sync`), Plugin manifest.
**Done when:** `docs/spike-findings.md` has a verdict and evidence for every question below, and Wyatt has read it. If question 1, 2 or 3 fails, the design needs a decision from Wyatt before phase 02.

## For Wyatt, before or during the session

- [ ] The stagenet node is synced (`scripts/check-env.sh`).
- [ ] `~/.config/xmr-pay-dev/stagenet.env` exists, mode 600, with `SHOP_ADDRESS`, `SHOP_VIEW_KEY` and `SHOP_RESTORE_HEIGHT` for your stagenet shop wallet (see `START-HERE.md`).
- [ ] For question 2, the public test hostname, set up per the runbook's updated "Later" section: a built copy of the dev site on port 4322, Cloudflare Access in front, only `/_emdash/api/plugins/*` bypassed. Claude will tell you when it's needed; the rest of the spike doesn't wait for it. Remove the hostname when the test is done.
- [ ] For questions 2 and 5 you'll run a few commands Claude gives you from your PC (through the SSH tunnel and the public hostname), and paste the output back.
- [ ] For question 11, you'll send one time-locked stagenet payment by hand from your buyer wallet when Claude asks.

**Start the session:**

```text
Phase 01, the spike. Read docs/phases/01-spike.md and docs/progress.md, then give me your plan.
```

## For Claude

Spike code is throwaway. Put it in `spikes/` (for example `spikes/xmr-spike/`, a plugin with slug `xmr-spike`), keep it small, and never import it from later phases. `init` is interactive by default, so scaffold it non-interactively from `spikes/`: `pnpm dlx @emdash-cms/plugin-cli@<exact version> init xmr-spike --yes --publisher <placeholder> --author-name "<name>" --security-email <email>` (check `init --help` for the current flags). For the placeholder use a syntactically valid DID that is obviously fake, such as `did:plc:` followed by 24 `a`s, and tell Wyatt. Install the spike into the dev site config-managed (`sandboxed: [...]`), and revert the dev site's config when the spike ends.

Test each question in **three** places where it applies, because behavior can differ: the plugin test host (`@emdash-cms/plugin-test`, Worker Loader), the dev site under `astro dev` (Miniflare), and the dev site as a built server (`node ./dist/server/entry.mjs`, workerd; the copy on port 4322 described in `docs/dev-environment.md`). Anything that has to run from Wyatt's PC (the SSH tunnel) or through the public hostname: write the exact commands for him (PowerShell `curl.exe` lines) and ask for the output.

**Questions**

1. **Ed25519 in the isolate (gate).** A public route declared with `pluginRoute({ request: { body: "text", headers: ["x-xmr-ts", "x-xmr-sig"], maxBytes: 65536 } })` verifies a base64 Ed25519 signature over `x-xmr-ts + "\n" + rawBody` with `crypto.subtle.importKey("raw", …, { name: "Ed25519" }, false, ["verify"])` and `crypto.subtle.verify`. Sign from a Node script with `node:crypto`. Check: valid signature passes; one changed byte fails; non-ASCII and a trailing newline in the body survive byte-for-byte; header names arrive lowercased; undeclared headers are stripped. If the `Ed25519` name fails, try the older `NODE-ED25519` naming and record which works where.
2. **Non-browser POST (gate).** A POST with no `Origin` header reaches the spike's public route on the dev site directly, through the SSH tunnel, and through the public test hostname (built copy, behind Cloudflare Access with the plugin-route bypass). Record any proxy, WAF, Access or bot rule that blocks it, and the exact response. Also confirm that the hostname's root and admin paths ask for the Access login. Wyatt sets up the hostname and runs the PC-side commands; ask when you get here.
3. **Cron on Node (gate).** Find the cron API in the installed `emdash` type definitions and the docs. Does scheduling from `plugin:install` work? What granularity does the Node runner give (fire a task every minute and log timestamps for 15 minutes)? Does it survive a dev-site restart?
4. **Settings storage.** Do sandboxed plugins get `ctx.settings` with encrypted secret fields in this EmDash version, or only plain KV? (xmr-pay stores no secrets either way; this is for the record.)
5. **Client IP.** What does `routeCtx.requestMeta` contain on a public route: directly, through the SSH tunnel, through the Cloudflare tunnel? Is it the real client IP?
6. **Pool claims.** On the Node runner, does `updateIf` (or `compareAndSet`) let exactly one of 20 concurrent requests claim the same `free` pool row? Run it against the dev site's database.
7. **Time-lock field.** Write a small script that runs `monero-wallet-rpc` on stagenet (wallet dir under `~/xmr-pay-dev-data/`) and creates a view-only wallet with `generate_from_keys`, sending the request body on stdin so the view key never appears on a command line. Run it through `scripts/with-shop-env.sh`. Ask Wyatt to send a small normal payment and a small time-locked payment to two different subaddresses. Record what `get_transfers` (with `in` and `pool`) returns for each: `unlock_time`, `locked`, `height`, `timestamp`, `double_spend_seen`. Which field reliably marks the buyer-set time lock? Never print the view key.
8. **Regtest (optional, for phase 03 tests).** Can `monerod --regtest --offline --fixed-difficulty 1` plus wallet-rpc run fast local chain tests: create throwaway regtest wallets, mine with `generateblocks`, send, confirm, and pop blocks to simulate a reorg? Note any flags needed (for example `--allow-mismatched-daemon-version`). Keep data under `~/xmr-pay-dev-data/regtest/`, never print the throwaway wallets' seeds or keys, and delete them after.
9. **Bundle budget.** What does the scaffold's `backend.js` weigh? How much would `zod` (full) or `zod/mini` add? The cap is 128 KB.

**Deliverable:** `docs/spike-findings.md` with one table row per question (question, verdict, evidence: test name or exact command and output, effect on the spec), then a short "recommendations" section. Anything that contradicts the spec also gets an entry in `docs/spec-changes.md`.

**Stop points:** if Ed25519 fails anywhere, report and propose the spec's fallback (HMAC with a secret in encrypted settings, if sandboxed plugins have them), but do not implement it. Stop at the end of the spike; do not start phase 02.

**Out of scope:** real plugin code, the bridge.
