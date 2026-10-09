# Phase 04 — Admin page

**Goal:** the Block Kit admin page and dashboard widget that make setup a checklist and upkeep a glance.
**Spec sections:** Admin setup and upkeep (install flow, configuration, upkeep, health, review queue), Plugin manifest (`admin` pages and widgets), Invoice lifecycle (row actions), Security model (pairing).
**Done when:** every block below renders in the dev site's admin, every action is covered by a runtime-host test, responses stay inside Block Kit's limits, and Wyatt has clicked through it.

## For Wyatt, before the session

- [ ] Phases 02 and 03 are done (a real stagenet payment has settled).
- [ ] You'll look at the page in the dev site's admin through the SSH tunnel, and optionally paste blocks into the Block Kit playground (https://blocks.emdashcms.com/).

**Start the session:**

```text
Phase 04, admin page. Read docs/phases/04-admin-page.md and docs/progress.md, then give me your plan.
```

## For Claude

**The page, top to bottom**

1. **Setup checklist** (shown until the first test tip settles, then collapses): wallet host paired, wallet synced, addresses ready, price feed answering, test tip received (at least 0.0001 XMR). Each unchecked item says what to do next. The test-tip item has a **Get a test address** button: it creates an open `kind: "tip"` invoice through the private `admin` route (the core has supported tip-shaped invoices since phase 02; public tip checkout comes in phase 07) and shows the subaddress, the dust floor and the `monero:` URI as copyable text. A QR code here would need a new route, so ask before proposing one.
2. **Connect wallet host:** a button that issues a pairing code and shows the one install command with the code built in, a 15-minute countdown, and the cautious manual path. Pressing it again issues a new code; a completed pairing replaces the old key and says so.
3. **Health:** one line per check: paired, last sync, wallet height against the expected height, free addresses (a meter against the pool target), price feed, review items, a run of unpaid expired invoices, remote-node cross-check. A red line names its fix, for example "Wallet host silent for 12 min. On the wallet host, run `xmr-bridge status`."
4. **Review queue:** underpaid, late, reorg and reversed invoices, each with what happened and one recommended action applied with one click.
5. **Invoices:** a paged table (status, amount in fiat and XMR, received, confirmations, created, expires) with row actions: mark settled, expire, copy txid, raise confirmations (never lower). Not-counted transfers (time-locked, double-spend flag) are listed with the reason.
6. **Settings:** currency and confirmation speed, with a note that changes affect new invoices only. The bridge public key read-only (no "paste a key by hand" fallback: spec change 19); `xmr-bridge status` prints the same key.
7. **Dashboard widget `xmr-status`:** one line of health and the count of review items.

**Wording to change (Wyatt, phase 02 session 2f):** the 2e page's "Free addresses: 48 of 50" (and the widget's "48 free addresses") read to Wyatt like linked wallets. Reword both so they say what they are: unused one-time payment addresses from the shop's own wallet, which the wallet host tops up by itself. A suggestion for Wyatt to accept or change: "Payment addresses ready: 48 of 50", with a hint line "Each payment gets its own address from your wallet. The wallet host adds more automatically." Labels are in `plugin/src/admin.ts` (the status field and the widget's health line). The spec's Health list says "free addresses" as the check's name; whether its wording changes too is Wyatt's call. See `docs/setup-friction.md`, 2026-10-03, session 2f admin page wording.

**Unpaid address gap (spec change 9, if Wyatt accepts it):** the shop's wallet app finds payments only within a lookahead window (200 addresses by default) past the last address that received money. Abandoned checkouts each use an address, so a long run of them can leave a real payment missing from the app's balance. Next to the Health line "a run of unpaid expired invoices", work out the gap (highest claimed pool index minus the highest index with a counted payment) and show a red line before it gets close: a constant threshold (proposed 150), never a setting. The line names the fix in the wallet app, using the remedy phase 03 found on stagenet. Test it in the runtime host at, just below and above the threshold.

**Rules**

- No new settings beyond the spec's three. If a design need seems to call for one, stop and ask.
- Every admin action is validated with hand-written checks (no schema library; `CLAUDE.md`, "Dependency tiers") and re-checked against the invoice's current state (an invoice may have changed since the page loaded).
- Write blocks as plain JSON objects, with small local helper functions if they help readability; don't use `@emdash-cms/blocks`. The Block Kit playground is fine for checking layout, since nothing from it ships.
- Stay inside Block Kit's limits (256 KiB, 2,000 nodes, 1,000 items per array): page the invoice table.
- Buyer-supplied text (email, note, refund address) appears only as plain text.
- The install URL is a constant in the plugin, still a placeholder until phase 09. Under the one command, show the spec's cautious path (`xmr-bridge install --site <url> --pair <code>`) with the same code; that's also what Wyatt uses with a locally built bridge during development. A sandboxed plugin can't read environment variables, so don't plan a separate "dev build" of the plugin.

**Tests:** runtime host `admin.loadPage()`, `act()`, `submit()` for every block and action, including stale-state actions (mark settled on an invoice that just settled), a pairing code that expires, and a page with hundreds of invoices.

**Stop points:** any new setting or admin step; anything that changes the manifest's `admin` declarations.

**Out of scope:** theme components, tips and orders (their admin views come with phases 07 and 08).
