/**
 * The admin route: the Monero payments page and the dashboard widget (phase 04). Block Kit as plain JSON objects
 * (CLAUDE.md, "Dependency tiers"). Session 4a: the health panel and the widget. Session 4b: the setup checklist with
 * Get a test address, pairing notes, the bridge key. Session 4c: the invoice table and row actions. Session 4d: the
 * review queue, reworked after Wyatt's click-through (2026-10-09) into "Needs a decision", with the page reordered. His
 * second click-through (~/xmr-pay-dev-data/04-ui-2/notes.md) turned the table into toggles that open in place and moved
 * Connect a new wallet host out of its toggle. Settings and Connect wallet host are from phase 02 session 2e.
 */
import type { PluginContext } from "emdash/plugin";

import { MAX_OPEN_TOTAL, checkoutHeight, claimAndStore, newIds } from "./checkout";
import { DUST_ATOMIC, GAP_ALERT, GOODS_ENABLED, LATE_WINDOW_MS, MAX_REQUIRED, PRESETS, RECONFIRM_BLOCKS, SILENT_MS, type Speed, TEST_TIP_REQUIRED, UNPAID_RUN_ALERT } from "./core/constants";
import { type Invoice, counted, isOpen, newInvoice, totals } from "./core/invoice";
import { atomicToXmr } from "./core/money";
import { invoiceUri } from "./core/uri";
import { ensureCron } from "./housekeeping";
import { CURRENCIES, type Currency, getRate, isCurrency } from "./rates";
import { KV, SETTING, invoices, pool } from "./store";
import type { BridgeState } from "./sync/handle";
import { type PairingState, PAIRING_TTL_MS, isPairingActive, newPairingCode } from "./sync/pairing";
import { POOL_TARGET } from "./sync/protocol";

/** The release host arrives in phase 09. ".invalid" never resolves, so a copied command fails instead of running. */
export const INSTALL_URL = "https://REPLACE-RELEASE-HOST.invalid/install.sh";
export const PAGE = "/payments";
export const WIDGET = "widget:xmr-status";

type Block = Record<string, unknown>;
type Toast = { message: string; type: "success" | "error" | "info" };
export interface AdminResponse {
	blocks: Block[];
	toast?: Toast;
}

const SPEED_LABELS: Record<Speed, string> = {
	fast: "Fast (1 / 3 / 5 confirmations)",
	standard: "Standard (2 / 5 / 10 confirmations)",
	strict: "Strict (10 confirmations)",
};
const isSpeed = (v: unknown): v is Speed => typeof v === "string" && Object.hasOwn(PRESETS, v);

function ago(ms: number): string {
	const min = Math.floor(ms / 60_000);
	if (min < 1) return "less than a minute ago";
	if (min < 60) return `${min} min ago`;
	const h = Math.floor(min / 60);
	return `${h} h ${min % 60} min ago`;
}
const utc = (ms: number) => `${new Date(ms).toISOString().slice(11, 16)} UTC`;
const utcSeconds = (ms: number) => `${new Date(ms).toISOString().slice(11, 19)} UTC`;

interface Health {
	paired: boolean;
	bridge: BridgeState | null;
	free: number;
	/**
	 * Set when the wallet host is paired and nothing at all has come from it for SILENT_MS (spec change 2): no sync,
	 * no "starting" message, no pairing (spec change 29).
	 */
	silentFor: number | null;
	/** Since the last full sync; null before the first one. */
	lastSyncAgo: number | null;
	/** Paired and heard from, but never fully synced since this pairing (spec change 29). */
	neverSynced: boolean;
	review: number;
	unpaidRun: number;
	/** Highest claimed pool index minus the highest paid one (spec change 9). */
	gap: { value: number; paidTop: number; claimedTop: number };
	/** The price check: a rate, null when both services failed, undefined when not checked (the widget). */
	rate?: { minor: bigint; source: string; currency: Currency } | null;
	clientIp: boolean | null;
}

/** The highest subaddress index with a counted payment; worked out once from the invoices if it was never recorded. */
async function paidTop(ctx: PluginContext): Promise<number> {
	const stored = await ctx.kv.get<number>(KV.paidTop);
	if (stored !== null) return stored;
	let top = 0;
	let cursor: string | undefined;
	for (let page = 0; page < 10; page++) {
		const r = await invoices(ctx).query({ limit: 100, ...(cursor ? { cursor } : {}) });
		for (const { data } of r.items) if (data.addrIndex > top && data.transfers.some((t) => counted(t) && t.amountAtomic !== "0")) top = data.addrIndex;
		if (!r.hasMore || !r.cursor) break;
		cursor = r.cursor;
	}
	await ctx.kv.set(KV.paidTop, top);
	return top;
}

async function health(ctx: PluginContext, now: number, opts: { checkRate: boolean }): Promise<Health> {
	const paired = Boolean(await ctx.settings.get<string>(SETTING.publicKey));
	const bridge = await ctx.kv.get<BridgeState>(KV.bridge);
	const free = await pool(ctx).count({ status: "free" });
	// The silent-bridge flag is worked out here, when the admin page or widget loads (spec change 2). Silence counts
	// from the last message of any kind, so a slow but healthy first start, which sends "starting" about every 90 s,
	// never looks silent (spec change 29). Older states have no lastHeardAt: their last sync stands in.
	const heard = bridge ? (bridge.lastHeardAt ?? bridge.lastSyncAt) : undefined;
	const silentFor = paired && heard !== undefined && now - heard > SILENT_MS ? now - heard : null;
	const review = await invoices(ctx).count({ status: "review" });
	// The newest invoices past their deadline: count the expired, unpaid ones until the first that isn't (open invoices
	// still waiting for evidence are skipped).
	const recent = await invoices(ctx).query({ where: { expiresAt: { lt: now } }, orderBy: { expiresAt: "desc" }, limit: 2 * UNPAID_RUN_ALERT });
	let unpaidRun = 0;
	for (const { data } of recent.items) {
		if (isOpen(data)) continue;
		if (data.status !== "expired" || data.transfers.length > 0 || unpaidRun === UNPAID_RUN_ALERT) break;
		unpaidRun++;
	}
	const claimed = await pool(ctx).query({ where: { status: "claimed" }, orderBy: { addrIndex: "desc" }, limit: 1 });
	const claimedTop = claimed.items[0]?.data.addrIndex ?? 0;
	const top = await paidTop(ctx);
	const gap = { value: Math.max(0, claimedTop - top), paidTop: top, claimedTop };
	let rate: Health["rate"];
	if (opts.checkRate) {
		const setting = await ctx.settings.get<string>(SETTING.currency);
		const currency: Currency = isCurrency(setting) ? setting : "USD";
		const r = await getRate(ctx, currency, now);
		rate = r ? { minor: r.minor, source: r.source, currency } : null;
	}
	const clientIp = await ctx.kv.get<boolean>(KV.clientIp);
	const lastSyncAgo = bridge?.lastSyncAt !== undefined ? now - bridge.lastSyncAt : null;
	const neverSynced = paired && bridge !== null && lastSyncAgo === null;
	return { paired, bridge, free, silentFor, lastSyncAgo, neverSynced, review, unpaidRun, gap, rate, clientIp };
}

const minorText = (m: bigint) => `${m / 100n}.${(m % 100n).toString().padStart(2, "0")}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Red (error) and amber (alert) lines, worst first, each naming its fix. */
function problems(h: Health): Array<{ variant: "error" | "alert"; title: string; description: string }> {
	const out: ReturnType<typeof problems> = [];
	const checks = h.bridge?.checks;
	if (h.silentFor !== null && h.neverSynced) {
		out.push({ variant: "error", title: "Paired, but the wallet host hasn't synced", description: `Nothing has come from it for ${Math.floor(h.silentFor / 60_000)} min. On the wallet host, run: sudo xmr-bridge status --config /etc/xmr-bridge/config` });
	} else if (h.silentFor !== null) {
		out.push({ variant: "error", title: `Wallet host silent for ${Math.floor(h.silentFor / 60_000)} min`, description: "Checkout is paused until it syncs again. On the wallet host, run: xmr-bridge status" });
	} else if (h.lastSyncAgo !== null && h.lastSyncAgo > SILENT_MS && checks?.wallet?.state === "starting") {
		out.push({ variant: "alert", title: "The wallet host is starting", description: "Monero's wallet program is opening the wallet, which can take a few minutes. Checkout is paused until the next sync." });
	}
	if (h.paired && !h.bridge) out.push({ variant: "alert", title: "Wallet host paired but not syncing yet", description: "On the wallet host, run: xmr-bridge status" });
	if (checks?.wallet?.state === "syncing") {
		out.push({ variant: "error", title: "The wallet host's node is still syncing", description: `${checks.wallet.detail ?? "The wallet host's node is still catching up with the network; payments show up once it has"}. Checkout is paused until then. A new node can take hours; it needs nothing from you. On the wallet host, xmr-bridge status shows the progress.` });
	}
	if (checks?.wallet?.state === "behind") {
		out.push({ variant: "error", title: "The wallet is behind its node", description: `${checks.wallet.detail ?? "The wallet is behind its node"}. It catches up by itself after a restart or an outage; if this stays, run xmr-bridge status on the wallet host.` });
	}
	if (checks?.node?.state === "mismatch") out.push({ variant: "error", title: "The wallet host's node disagrees with a second node", description: checks.node.detail ?? "Payments in the disputed block are held at 0 confirmations. Use your own node, or one you trust" });
	// Before the first full sync the pool is empty by design; the checklist says so.
	if (h.paired && h.lastSyncAgo !== null && h.free === 0) out.push({ variant: "error", title: "No payment addresses ready", description: "Checkout can't take payments until the wallet host adds more, which it does at its next sync. If this stays, run xmr-bridge status on the wallet host." });
	if (h.rate === null) out.push({ variant: "error", title: "Price feed not answering", description: "Both price services failed just now, so checkout refuses new orders until one answers. It retries by itself; if this lasts, check the site's outbound network." });
	if (h.gap.value >= GAP_ALERT) {
		out.push({
			variant: "error",
			title: "Your wallet app may miss payments",
			description: `${h.gap.value} payment addresses have gone unpaid since the last payment (address #${h.gap.paidTop}). Wallet apps look only about 200 addresses past the last paid one, so a payment to a later address can be missing from your wallet app's balance (Coffer still sees it). In your wallet app, create receiving addresses up to #${h.gap.claimedTop}, then rescan the wallet.`,
		});
	}
	if (checks?.wallet?.state === "unavailable") out.push({ variant: "alert", title: "The wallet host can't read its node's height", description: checks.wallet.detail ?? "On the wallet host, run: xmr-bridge status" });
	if (checks?.node?.state === "unavailable") out.push({ variant: "alert", title: "Remote-node cross-check unavailable", description: checks.node.detail ?? "No second node answered; confirmations are reported as the configured node gives them" });
	if (h.review > 0) out.push({ variant: "alert", title: `${plural(h.review, "invoice needs", "invoices need")} a decision`, description: "They're under Needs a decision, below Health, each with what happened and a recommended action." });
	if (h.unpaidRun >= UNPAID_RUN_ALERT) out.push({ variant: "alert", title: `The last ${h.unpaidRun} checkouts expired unpaid`, description: "Buyers may be stuck. Open your pay page and check that it shows the address and the amount, then try a small test payment." });
	return out;
}

function walletHeightText(h: Health): string {
	const w = h.bridge?.checks?.wallet;
	if (w?.state === "starting") return "Starting (opening the wallet)";
	if (!h.bridge || h.lastSyncAgo === null) return "Unknown until the wallet host syncs";
	if (w?.state === "ok") return `${h.bridge.height}, in step with its node`;
	if (w?.state === "behind") return `${h.bridge.height}: ${w.detail ?? "behind its node"}`;
	if (w?.state === "syncing") return `${h.bridge.height}: ${w.detail ?? "its node is still catching up with the network"}`;
	if (w?.state === "unavailable") return `${h.bridge.height} (its node's height is unknown${w.detail ? `: ${w.detail}` : ""})`;
	return String(h.bridge.height);
}

const NODE_CHECK_TEXT = { off: "Off (the wallet host uses your own node)", ok: "OK", unavailable: "Unavailable", mismatch: "Mismatch" } as const;

/** The red and amber lines, then the update notice: shown at the top of the page. */
function bannerBlocks(h: Health): Block[] {
	const blocks: Block[] = problems(h).map((p) => ({ type: "banner", ...p }));
	if (h.bridge?.outdated) blocks.push({ type: "banner", variant: "default", title: "Wallet host update available", description: "On the wallet host, run: xmr-bridge update" });
	return blocks;
}

function healthBlocks(h: Health): Block[] {
	const blocks: Block[] = [];
	const node = h.bridge?.checks?.node?.state;
	blocks.push(
		{ type: "divider" },
		{ type: "header", text: "Health" },
		{
			type: "fields",
			block_id: "health",
			fields: [
				{ label: "Wallet host", value: h.paired ? "Paired" : "Not paired" },
				{ label: "Last sync", value: h.lastSyncAgo === null ? "Never" : ago(h.lastSyncAgo) },
				{ label: "Wallet height", value: walletHeightText(h) },
				{ label: "Price feed", value: h.rate ? `1 XMR = ${minorText(h.rate.minor)} ${h.rate.currency} (${h.rate.source})` : "Not answering" },
				{ label: "Review items", value: h.review === 0 ? "None" : `${h.review} need a decision` },
				{ label: "Unpaid checkouts in a row", value: String(h.unpaidRun) },
				{ label: "Remote-node cross-check", value: node ? NODE_CHECK_TEXT[node] : "Not reported yet" },
				{ label: "Unpaid addresses since the last payment", value: `${h.gap.value} (warning at ${GAP_ALERT})` },
			],
		},
		{ type: "meter", label: "Payment addresses ready", value: h.free, max: POOL_TARGET, custom_value: `${h.free} of ${POOL_TARGET}` },
		{ type: "context", text: "Each payment gets its own address from your wallet. The wallet host adds more automatically." },
	);
	if (h.clientIp === false) {
		blocks.push({ type: "context", text: `Per-visitor spam limits are off: this site doesn't pass visitors' IP addresses to plugins. The site-wide limit of ${MAX_OPEN_TOTAL} open invoices still applies.` });
	}
	return blocks;
}

/** The newest test tips (kind "tip" invoices made from this page; public tips come in phase 07). */
async function testTips(ctx: PluginContext): Promise<Invoice[]> {
	// The admin's own test tips only: a visitor's tip (via "checkout", phase 07) never completes setup or stands in for
	// the test address. Bounded: the newest 100 tips, which on a busy site may hold no test tip after setup (fine then).
	const r = await invoices(ctx).query({ where: { kind: "tip" }, orderBy: { createdAt: "desc" }, limit: 100 });
	return r.items.map((i) => i.data).filter((t) => t.via === undefined).slice(0, 10);
}

/** The test tip's monero: URI description (stored on the invoice; spec change 32). */
const TEST_TIP_DESCRIPTION = "Coffer test tip";
/** XMR without trailing zeros, as wallet apps show it: "0.0002", not "0.000200000000". */
const shortXmr = (atomic: bigint) => atomicToXmr(atomic).replace(/0+$/, "").replace(/\.$/, "");

/** How long a settled test tip's details stay at the top of the page (spec change 24); after that, only in Setup. */
const TEST_TIP_TOP_MS = 24 * 60 * 60_000;

/**
 * What to look for in the shop's wallet app once the test tip settles, and why it might be missing (spec change 24,
 * items 1 and 2; run A attempt 2, where the wallet's restore height was above the tip's block). Empty when nothing
 * counted, as for a test tip an admin marked settled.
 */
function testTipBlocks(tip: Invoice, h: Health): Block[] {
	const paid = tip.transfers.filter(counted).sort((a, b) => a.height - b.height);
	if (paid.length === 0) return [];
	const block = paid[0].height;
	const listed = paid.slice(0, TRANSFERS_LISTED).map((t) => `${shortXmr(BigInt(t.amountAtomic))} XMR in block ${t.height}\nTransaction ID: ${t.txid}`);
	if (paid.length > TRANSFERS_LISTED) listed.push(`…and ${paid.length - TRANSFERS_LISTED} more payments.`);
	const synced = h.bridge ? `block ${h.bridge.height} (the wallet host's height now)` : "the wallet host's height (under Health)";
	return [
		{ type: "section", text: `${shortXmr(totals(tip).received)} XMR arrived in block ${block}${tip.settledAt ? `, settled at ${utc(tip.settledAt)}` : ""}. Look for this in your shop wallet's history.` },
		{ type: "code", code: listed.join("\n\n") },
		{ type: "context", text: `Not in your wallet app? It must be synced to ${synced}, and its restore height must be at or below block ${block}. If the restore height is higher, restore the wallet again with a lower one; otherwise rescan.` },
	];
}

/**
 * The setup checklist (spec, Install flow step 4), as a toggle: open near the top until a test tip settles, then closed
 * in Settings for good (Wyatt, 2026-10-09). The settled tip's details go inside it, and for a day also at the top
 * (`recentTip`; Wyatt, 2026-10-15). Until it's done, it ends with when the page was checked and a Check again button:
 * EmDash 1.1.0's admin pages load once and never poll (spec change 27). Not while the install command is on screen
 * (`showingCommand`): it's shown once, so a re-render would lose it.
 */
async function setupSection(ctx: PluginContext, h: Health, now: number, showingCommand: boolean): Promise<{ done: boolean; toggle: Block; recentTip: Block[] }> {
	const tips = await testTips(ctx);
	let done = (await ctx.kv.get<boolean>(KV.setupDone)) === true;
	if (!done && tips.some((t) => t.status === "settled")) {
		done = true;
		await ctx.kv.set(KV.setupDone, true);
	}
	const wallet = h.bridge?.checks?.wallet;
	const synced =
		h.lastSyncAgo !== null && h.lastSyncAgo <= SILENT_MS && h.silentFor === null && wallet?.state !== "behind" && wallet?.state !== "syncing" && wallet?.state !== "starting";
	const rows: Array<[string, boolean, string]> = [
		["Wallet host paired", h.paired, "press Connect wallet host below and run the command on your wallet host."],
		[
			"Wallet synced",
			synced,
			h.silentFor !== null
				? "the wallet host is silent. On the wallet host, run: xmr-bridge status"
				: wallet?.state === "starting"
					? "the wallet host is starting Monero's wallet program. This can take a few minutes."
					: wallet?.state === "syncing"
						? `${wallet.detail ?? "the wallet host's node is still catching up with the network"}. A new node can take hours.`
						: wallet?.state === "behind"
							? `the wallet is catching up with its node (${wallet.detail ?? "behind"}).`
							: "the wallet host syncs within a minute of pairing.",
		],
		["Payment addresses ready", h.free > 0, "the wallet host adds them at its first sync."],
		["Price feed answering", Boolean(h.rate), "both price services failed just now; this page checks again when it loads."],
		["Test tip received", done, `once the items above are done, press Get a test address and send at least ${shortXmr(DUST_ATOMIC)} XMR to it.`],
	];
	const inner: Block[] = [{ type: "fields", fields: rows.map(([label, ok, next]) => ({ label, value: ok ? "Done" : `To do: ${next}` })) }];
	const settled = tips.find((t) => t.status === "settled");
	const tipBlocks = settled ? testTipBlocks(settled, h) : [];
	inner.push(...tipBlocks);
	const ready = rows.slice(0, 4).every(([, ok]) => ok);
	if (!done && ready && h.bridge) {
		inner.push({ type: "context", text: `Open your shop wallet app and let it finish syncing. If the wallet is new, check that its restore height is at or below block ${h.bridge.height} (the wallet host's height now).` });
		const open = tips.find((t) => isOpen(t));
		if (open) {
			const t = totals(open);
			inner.push(
				{ type: "section", text: `Send at least ${shortXmr(DUST_ATOMIC)} XMR to this address from any wallet. It's a tip to your own shop wallet, so the money stays yours.` },
				{ type: "code", code: open.subaddress },
				{ type: "code", code: invoiceUri(open) },
				// Feather 2.8.1 reads a monero: link only from a keyboard paste; pasted another way it looks like an OpenAlias
				// (run B attempt 2), so the label says how to paste and what to do instead.
				{ type: "context", text: "Payment link: wallets that read one fill in the address and amount. Paste it with the keyboard (Ctrl+V, or Cmd+V on a Mac). If your wallet doesn't fill in the address, or says it can't resolve an OpenAlias, copy the address above instead." },
				{ type: "context", text: open.status === "new" ? `Waiting for the payment (until ${utc(open.expiresAt)}).` : `Payment seen: ${t.depth} of ${plural(open.required, "confirmation", "confirmations")}.${open.required === TEST_TIP_REQUIRED ? " A test tip needs one; your buyers' payments use your confirmation speed." : ""}` },
			);
		}
		inner.push({ type: "actions", elements: [{ type: "button", action_id: "get_test_address", label: "Get a test address" }] });
	}
	if (!done && showingCommand) inner.push({ type: "context", text: "Reload this page after the installer says Done." });
	else if (!done)
		inner.push(
			{ type: "context", text: `Checked at ${utcSeconds(now)}. This page doesn't update by itself.` },
			{ type: "actions", elements: [{ type: "button", action_id: "check_again", label: "Check again" }] },
		);
	const count = rows.filter(([, ok]) => ok).length;
	const recent = settled?.settledAt !== undefined && now - settled.settledAt < TEST_TIP_TOP_MS && tipBlocks.length > 0;
	return {
		done,
		toggle: { type: "accordion", block_id: "setup", label: done ? "Setup (complete)" : `Setup: ${count} of 5 done`, default_open: !done, blocks: inner },
		recentTip: recent ? [{ type: "header", text: "Test tip received" }, ...tipBlocks] : [],
	};
}

/**
 * Get a test address: an open tip invoice on a pool address, through this private route (phase 07 adds public tips). It
 * needs TEST_TIP_REQUIRED confirmations, not the speed preset (spec change 26).
 */
async function testAddress(ctx: PluginContext, now: number): Promise<Toast> {
	if (!(await ctx.settings.get<string>(SETTING.publicKey))) return { type: "error", message: "Connect a wallet host first." };
	const chainHeight = checkoutHeight(await ctx.kv.get<BridgeState>(KV.bridge), now);
	if (chainHeight === "WALLET_HOST_SILENT") return { type: "error", message: "The wallet host must be syncing first. On the wallet host, run: xmr-bridge status" };
	if (chainHeight === "WALLET_HOST_SYNCING") return { type: "error", message: "The wallet host's node is still catching up with the network, so a test payment can't show up yet. On the wallet host, xmr-bridge status shows the progress." };
	if ((await testTips(ctx)).some((t) => isOpen(t))) return { type: "info", message: "Your test address is below." };
	const speedSetting = await ctx.settings.get<string>(SETTING.speed);
	const speed: Speed = isSpeed(speedSetting) ? speedSetting : "standard";
	const currencySetting = await ctx.settings.get<string>(SETTING.currency);
	const inv = await claimAndStore(ctx, (row) =>
		({ ...newInvoice({ ...newIds(), kind: "tip", fiatMinor: null, currency: isCurrency(currencySetting) ? currencySetting : "USD", rate: null, speed, subaddress: row.address, addrIndex: row.addrIndex, now, chainHeight, uriDescription: TEST_TIP_DESCRIPTION }), required: TEST_TIP_REQUIRED }),
	);
	if (!inv) return { type: "error", message: "No payment address is free yet. The wallet host adds them at its next sync; try again in a minute." };
	return { type: "success", message: "Test address ready. Send the test tip from any wallet." };
}

/**
 * The install command for the wallet host, on four short lines so it fits the page (setup test, run A attempt 1):
 * curl, else wget (a clean Ubuntu 24.04 container has no curl), else a plain message saying what to install. One tool
 * is chosen before anything downloads, so a half-finished curl can't be followed by a second copy. The shell runs it
 * once `fi` arrives, so pasting all four lines runs it once. Kept as one template literal: the bridge's tests run it
 * under sh (bridge/internal/installer/installcmd_test.go).
 */
export function installCommand(siteUrl: string, code: string): string {
	return `if command -v curl >/dev/null; then curl -fsSL ${INSTALL_URL}
elif command -v wget >/dev/null; then wget -nv -O- ${INSTALL_URL}
else echo "This needs curl or wget: sudo apt install curl, then paste again." >&2
fi | sh -s -- --site ${siteUrl} --pair ${code}`;
}

/** The address the install command uses, and where it came from (spec change 23). */
export type WalletHostSite =
	| { url: string; source: "saved" | "browser"; saved: string; browser?: string }
	| { url: null; saved: string };

/** An https origin with nothing after it (no path, login, query), not on this machine; else null. */
function publicHttpsOrigin(s: string | undefined): string | null {
	if (!s) return null;
	let u: URL;
	try {
		u = new URL(s);
	} catch {
		return null;
	}
	if (u.protocol !== "https:" || u.origin !== s.replace(/\/$/, "") || isLoopbackHost(u.hostname)) return null;
	return u.origin;
}

function isLoopbackHost(host: string): boolean {
	const h = host.toLowerCase().replace(/^\[|\]$/g, "");
	return h === "localhost" || h.endsWith(".localhost") || /^127\.\d+\.\d+\.\d+$/.test(h) || h === "::1";
}

/**
 * EmDash 1.1.0 gives a sandboxed plugin only the address saved at site setup (`emdash:site_url`); a site first set up
 * under `astro dev` keeps http://localhost:4321 for good, and neither siteUrl nor EMDASH_SITE_URL changes it. A saved
 * public https address is always used (a different browser origin only adds a warning). Otherwise the admin's own
 * browser origin is used if it's a public https one: it comes from the private admin route only (signed-in admins
 * with plugins:manage), never from a public route (matrix row F06). Anything else: no address, no command.
 */
export function walletHostSite(savedUrl: string, browserOrigin: string | undefined): WalletHostSite {
	const saved = savedUrl.replace(/\/$/, "");
	const browser = publicHttpsOrigin(browserOrigin);
	const savedPublic = publicHttpsOrigin(saved);
	if (savedPublic) return browser && browser !== savedPublic ? { url: savedPublic, source: "saved", saved, browser } : { url: savedPublic, source: "saved", saved };
	return browser ? { url: browser, source: "browser", saved } : { url: null, saved };
}

/** The site line and, when the address can't be used or two addresses disagree, a banner. */
function siteBlocks(site: WalletHostSite): Block[] {
	if (site.url === null) {
		const description = site.saved
			? `EmDash's saved address for this site is ${site.saved}, which a wallet host on another machine can't use: it needs your site's public https address. Open this page at that address (the one visitors use), and Coffer uses it instead.`
			: "EmDash has no saved address for this site. Open this page at your site's public https address (the one visitors use), and Coffer uses it.";
		return [{ type: "banner", variant: "error", title: site.saved ? "Your site's address can't be used for the wallet host" : "Your site's address isn't known", description }];
	}
	const line: Block = {
		type: "context",
		text: site.source === "browser" ? `The wallet host will connect to ${site.url} (from your browser, because EmDash's saved address for this site is ${site.saved || "empty"}).` : `The wallet host will connect to ${site.url} (EmDash's saved address for this site).`,
	};
	if (!site.browser) return [line];
	return [
		line,
		{ type: "banner", variant: "alert", title: "Two addresses for this site", description: `EmDash's saved address is ${site.url}, but you opened this page at ${site.browser}. The command uses ${site.url}. If the site has moved, the wallet host won't reach it there: open this page at ${site.url} to check it still answers.` },
	];
}

const minutesLeft = (expiresAt: number, now: number) => Math.max(0, Math.floor((expiresAt - now) / 60_000));

function installBlocks(siteUrl: string, code: string, expiresAt: number, now: number): Block[] {
	return [
		{ type: "banner", variant: "default", title: "Pairing code ready", description: `It works once, until ${utc(expiresAt)} (${minutesLeft(expiresAt, now)} min left). Run one of these on your wallet host (a Linux machine, not your site's server). The first is four lines: copy all four and paste them together.` },
		{ type: "code", language: "bash", code: installCommand(siteUrl, code) },
		{ type: "context", text: "Cautious path, if the bridge is already installed: download and verify it first, then run:" },
		{ type: "code", language: "bash", code: `xmr-bridge install --site ${siteUrl} --pair ${code}` },
	];
}

/** 10 a page: every invoice's details are in the response, closed or not, and the page must stay under Block Kit's
 * 2,000 nodes next to a full review queue (Wyatt, 2026-10-09, round 2). */
const INVOICE_PAGE = 10;
/** Payments listed per invoice, to keep one invoice's box well inside the 256 KiB response. */
const TRANSFERS_LISTED = 50;
const STATUS_TEXT: Record<Invoice["status"], string> = { new: "New", seen: "Seen", confirming: "Confirming", settled: "Settled", expired: "Expired", review: "Review" };
const statusText = (inv: Invoice) =>
	inv.status === "review" ? `Needs decision: ${inv.reviewReason ?? "review"}` : `${STATUS_TEXT[inv.status]}${inv.adminFinal ? " (by admin)" : ""}`;
const xmr = (atomic: bigint) => (atomic === 0n ? "0" : atomicToXmr(atomic));
const fiatText = (inv: Invoice) => (inv.fiat ? `${minorText(BigInt(inv.fiat.amountMinor))} ${inv.fiat.currency}` : "");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (ms: number) => `${MONTHS[new Date(ms).getUTCMonth()]} ${new Date(ms).getUTCDate()}`;
const dateTime = (ms: number) => `${shortDate(ms)}, ${utc(ms)}`;
/** Settled, expired, or decided by the admin: nothing will change it, so its expiry no longer means anything. */
const isFinal = (inv: Invoice) => inv.adminFinal === true || inv.status === "settled" || inv.status === "expired";

function since(ms: number): string {
	const min = Math.floor(ms / 60_000);
	if (min < 1) return "less than a minute ago";
	if (min < 60) return `${min} min ago`;
	const h = Math.floor(min / 60);
	if (h < 24) return `${plural(h, "hour", "hours")} ago`;
	return `${plural(Math.floor(h / 24), "day", "days")} ago`;
}

/**
 * The deepest counted transfer, so an underpaid or review invoice doesn't read "0 confirmations" (phase 03 3h note). A
 * payment that's gone says so instead of "None yet" (Wyatt, 2026-10-09).
 */
function confirmationsText(inv: Invoice): string {
	if (inv.status === "review" && inv.reviewReason === "reversed") return `No longer reported (needed ${inv.required})`;
	if (inv.status === "review" && inv.reviewReason === "reorg") return `Not mined again (needed ${inv.required})`;
	const deepest = Math.max(-1, ...inv.transfers.filter(counted).map((t) => t.confirmations));
	return `${deepest < 0 ? "None yet" : deepest} (needs ${inv.required})`;
}

/** Why a transfer doesn't count; empty when it does. unlock_time below 500000000 is a block height, otherwise a Unix time. */
function notCountedReasons(t: Invoice["transfers"][number]): string[] {
	const why: string[] = [];
	if (t.unlockTime !== "0") {
		const u = BigInt(t.unlockTime);
		why.push(`time-locked until ${u < 500_000_000n ? `block ${u}` : new Date(Number(u) * 1000).toISOString()}`);
	}
	if (t.doubleSpendSeen) why.push("flagged as a possible double spend");
	return why;
}

/** The amount counted now; for a gone payment, "now", and what was reported if a not-counted transfer remains. */
function receivedText(inv: Invoice): string {
	const now = xmr(totals(inv).received);
	if (inv.status === "review" && inv.reviewReason === "reorg") return `${now} XMR, not in a block now`;
	if (inv.status === "review" && inv.reviewReason === "reversed") {
		const held = inv.transfers.filter((t) => !counted(t));
		if (held.length === 0) return `${now} XMR now`;
		const sum = held.reduce((a, t) => a + BigInt(t.amountAtomic), 0n);
		const why = [...new Set(held.flatMap(notCountedReasons))].join("; ");
		return `${now} XMR now (${atomicToXmr(sum)} XMR was reported, now not counted: ${why})`;
	}
	return `${now} XMR`;
}

/** Change 8: a link to the product's editor; the host resolves it, so no lookup here. */
const productLink = (inv: Invoice): Block[] =>
	inv.productRef ? [{ type: "link", label: "Open product", target: { kind: "content", collection: inv.productRef.collection, id: inv.productRef.id } }] : [];

type Verb = "settle" | "expire" | "raise";
const VERB_LABELS: Record<Verb, string> = { settle: "Mark settled", expire: "Expire", raise: `Raise confirmations to ${MAX_REQUIRED}` };

/** What an admin may do to an invoice in its current state. A decision (settle, expire) is final. */
function allowed(inv: Invoice): Verb[] {
	if (inv.adminFinal) return [];
	const out: Verb[] = [];
	if (inv.status !== "settled") out.push("settle");
	if (isOpen(inv) || inv.status === "review") out.push("expire");
	if (isOpen(inv) && inv.required < MAX_REQUIRED) out.push("raise");
	return out;
}

/** A transfer with why it doesn't count, or "counted". */
function transferNote(t: Invoice["transfers"][number]): string {
	const why = notCountedReasons(t);
	const base = `${atomicToXmr(BigInt(t.amountAtomic))} XMR, ${t.confirmations} confirmations`;
	return why.length === 0 ? `${base}, counted` : `${base}, not counted: ${why.join("; ")}`;
}

/** The toggle's label: the invoice on one line, due and received told apart, no expiry (round 2, changes 1 and 6). */
function invoiceLabel(inv: Invoice, now: number): string {
	const parts = [statusText(inv)];
	if (inv.fiat) parts.push(fiatText(inv));
	if (inv.status === "review" && inv.reviewReason === "reversed") parts.push("payment no longer reported");
	else if (inv.status === "review" && inv.reviewReason === "reorg") parts.push("payment not mined again");
	else {
		const received = totals(inv).received;
		const due = inv.expectedAtomic ? BigInt(inv.expectedAtomic) : null;
		if (received === 0n) parts.push(due === null ? "nothing received" : `nothing received (${xmr(due)} XMR due)`);
		else if (due !== null && received < due) parts.push(`received ${xmr(received)} of ${xmr(due)} XMR`);
		else parts.push(`received ${xmr(received)} XMR`);
		const depths = inv.transfers.filter(counted).map((t) => t.confirmations);
		if (depths.length > 0) parts.push(plural(Math.max(...depths), "confirmation", "confirmations"));
	}
	parts.push(`created ${since(now - inv.createdAt)}`);
	return parts.join(" · ");
}

/**
 * Every payment in one box, each with its Transaction ID under it (round 2, change 4). One code block costs the same
 * few nodes whatever the count, which is what fits 10 invoices' details on one page.
 */
function transfersCode(inv: Invoice): string {
	const n = inv.transfers.length;
	const listed = inv.transfers.slice(0, TRANSFERS_LISTED).map((t, i) => `Payment ${i + 1} of ${n}: ${transferNote(t)}\nTransaction ID: ${t.txid}`);
	if (n > TRANSFERS_LISTED) listed.push(`…and ${n - TRANSFERS_LISTED} more payments.`);
	return listed.join("\n\n");
}

/**
 * One invoice: a closed toggle with the summary as its label, and inside it the details, the Actions menu and the long
 * values in their own boxes. Buyer-supplied text only as plain text. The invoice just acted on gets a new block_id and
 * starts open: the host keeps each toggle's open state by block_id.
 */
function invoiceItem(inv: Invoice, now: number, opts: { acted: boolean; cursor?: string }): Block {
	const fields = [
		{ label: "Status", value: statusText(inv) },
		...(inv.fiat ? [{ label: "Amount", value: fiatText(inv) }] : []),
		...(inv.expectedAtomic ? [{ label: "Due", value: `${xmr(BigInt(inv.expectedAtomic))} XMR` }] : []),
		{ label: "Received", value: receivedText(inv) },
		{ label: "Confirmations", value: confirmationsText(inv) },
		{ label: "Created", value: dateTime(inv.createdAt) },
		{ label: "Expires", value: isFinal(inv) ? "—" : dateTime(inv.expiresAt) },
		...(inv.buyer?.email ? [{ label: "Buyer email", value: inv.buyer.email }] : []),
	];
	const inner: Block[] = [{ type: "fields", fields }];
	const verbs = allowed(inv);
	const suffix = opts.cursor ? `|${opts.cursor}` : "";
	const elements: Block[] = [
		...(verbs.length > 0 ? [{ type: "menu", action_id: "invoice_action", label: "Actions", items: verbs.map((v) => ({ label: VERB_LABELS[v], value: `${v}:${inv.id}${suffix}` })) }] : []),
		...productLink(inv),
	];
	if (elements.length > 0) inner.push({ type: "actions", elements });
	inner.push({ type: "context", text: `Payment address (#${inv.addrIndex})` }, { type: "code", code: inv.subaddress });
	if (inv.buyer?.refundAddress) inner.push({ type: "context", text: "Buyer's refund address" }, { type: "code", code: inv.buyer.refundAddress });
	if (inv.buyer?.note) inner.push({ type: "context", text: `Buyer's note: ${inv.buyer.note}` });
	if (inv.transfers.length === 0) inner.push({ type: "context", text: "No payment reported yet." });
	else inner.push({ type: "context", text: "Find each payment in your wallet app's transaction history by its Transaction ID." }, { type: "code", code: transfersCode(inv) });
	return { type: "accordion", block_id: opts.acted ? `invoice_${inv.id}_acted` : `invoice_${inv.id}`, label: invoiceLabel(inv, now), default_open: opts.acted, blocks: inner };
}

async function invoiceBlocks(ctx: PluginContext, now: number, opts: PageOptions): Promise<Block[]> {
	const r = await invoices(ctx).query({ where: { kind: "product" }, orderBy: { createdAt: "desc" }, limit: INVOICE_PAGE, ...(opts.cursor ? { cursor: opts.cursor } : {}) });
	const blocks: Block[] = [{ type: "divider" }, { type: "header", text: "All invoices" }];
	if (r.items.length === 0) blocks.push({ type: "context", block_id: "invoices_empty", text: "No orders yet." });
	blocks.push(...r.items.map(({ data }) => invoiceItem(data, now, { acted: data.id === opts.acted, ...(opts.cursor ? { cursor: opts.cursor } : {}) })));
	const nav: Block[] = [];
	if (opts.cursor) nav.push({ type: "button", action_id: "invoices_newest", label: "Newest invoices" });
	if (r.hasMore && r.cursor) nav.push({ type: "button", action_id: "invoices_page", label: "Load more", value: { cursor: r.cursor } });
	if (nav.length > 0) blocks.push({ type: "actions", block_id: "invoices_nav", elements: nav });
	return blocks;
}

/** Review items per page: 12 worst-case items next to a full page of invoices stay under Block Kit's 2,000 nodes (a
 * reversed item with everything is about 64). Paged up to item 60, then the rest are pointed at in All invoices (Wyatt,
 * 2026-10-09). */
const REVIEW_STEP = 12;
const REVIEW_MAX = 60;
/** Review invoices read for ordering: red first needs the reason, which has no index (adding one is a stop point). */
const REVIEW_SCAN_PAGES = 5;
const REVIEW_TITLE: Record<NonNullable<Invoice["reviewReason"]>, string> = { late: "Late payment", underpaid: "Underpaid", reorg: "Payment not re-mined after a reorg", reversed: "Settled payment gone" };
/** Red where the money may be gone, yellow where it arrived and the admin decides (Wyatt, 2026-10-09). */
const isRed = (inv: Invoice) => inv.reviewReason === "reversed" || inv.reviewReason === "reorg";
const button = (label: string, value: string, style: "primary" | "secondary", confirm?: Record<string, string>): Block => ({ type: "button", action_id: "invoice_action", label, style, value, ...(confirm ? { confirm } : {}) });

/**
 * One review item: a banner with the reason and its invoice, then a closed "Details and actions" toggle with what
 * happened and the one recommended action (decisions.md, 2026-10-08 and 2026-10-09).
 */
function reviewItem(inv: Invoice): Block[] {
	const t = totals(inv);
	const expected = BigInt(inv.expectedAtomic ?? inv.minAtomic ?? "0");
	const pct = expected > 0n ? (t.received * 100n) / expected : 0n;
	const full = t.received >= t.threshold;
	const deepest = Math.max(0, ...inv.transfers.filter(counted).map((x) => x.confirmations));
	const reason = inv.reviewReason ?? "late";
	// All invoices lists product invoices only, and only with goods on (the release-1 switch, spec change 22).
	const rowHint = (accept: string) => (GOODS_ENABLED && inv.kind === "product" ? ` To accept ${accept} instead, find it under All invoices below and choose Mark settled from its Actions menu.` : "");
	let title = REVIEW_TITLE[reason];
	let what: string;
	let advice: string;
	const actions: Block[] = [];
	if (reason === "late" && full) {
		title += " · paid in full";
		what = `Paid in full (${xmr(t.received)} XMR), but mined after the invoice's deadline. The money is in your wallet.`;
		advice = "Recommended: mark it settled and fulfil the order.";
		actions.push(button("Mark settled", `settle:${inv.id}`, "primary"));
	} else if (reason === "late") {
		// Late and short of the price: like underpaid (Wyatt, Q2, 2026-10-09).
		title += ` · ${pct}% received`;
		what = `${xmr(t.received)} of ${xmr(expected)} XMR arrived (${pct}%), part of it after the invoice's deadline.`;
		advice = `Recommended: expire it, don't fulfil the order, and refund the buyer from your wallet app.${rowHint("it")}`;
		actions.push(button("Expire", `expire:${inv.id}`, "primary"));
	} else if (reason === "underpaid") {
		title += ` · ${pct}% received`;
		what = `${xmr(t.received)} of ${xmr(expected)} XMR arrived (${pct}%) by the deadline, ${deepest} confirmations.`;
		advice = `Recommended: expire it, don't fulfil the order, and refund the buyer from your wallet app.${rowHint("the smaller amount")}`;
		actions.push(button("Expire", `expire:${inv.id}`, "primary"));
	} else if (reason === "reorg") {
		what = `A chain reorganisation knocked the payment out of its block, and it wasn't mined again within ${RECONFIRM_BLOCKS} blocks.`;
		advice = "Recommended: expire it and don't fulfil the order.";
		actions.push(button("Expire", `expire:${inv.id}`, "primary"));
	} else {
		what = "This invoice was settled, but the wallet host no longer reports its payment (double-spent, or removed in a reorg).";
		advice = "Recommended: expire it and don't fulfil the order. If your wallet app still shows this payment, mark it settled instead: a reinstalled wallet host can report a payment gone by mistake.";
		actions.push(
			button("Expire", `expire:${inv.id}`, "primary"),
			button("Mark settled", `settle:${inv.id}`, "secondary", { title: "Mark this invoice settled?", text: "Only if your wallet app shows the payment. The decision is final.", confirm: "Mark settled", deny: "Cancel" }),
		);
	}
	actions.push(...productLink(inv));
	const fields = [
		{ label: "Received", value: receivedText(inv) },
		{ label: "Confirmations", value: confirmationsText(inv) },
		...(inv.buyer?.email ? [{ label: "Buyer email", value: inv.buyer.email }] : []),
	];
	// The refund address in its own box, never cut off in the fields grid (round 2, change 2).
	const refund: Block[] = inv.buyer?.refundAddress ? [{ type: "context", text: "Buyer's refund address" }, { type: "code", code: inv.buyer.refundAddress }] : [];
	const amount = inv.fiat ? fiatText(inv) : inv.kind;
	return [
		{ type: "banner", block_id: `review_${inv.id}`, variant: isRed(inv) ? "error" : "alert", title, description: `${inv.id} · ${amount} · created ${shortDate(inv.createdAt)}` },
		{
			type: "accordion",
			block_id: `review_${inv.id}_details`,
			label: "Details and actions",
			default_open: false,
			blocks: [{ type: "section", text: what }, { type: "context", text: advice }, { type: "fields", fields }, ...refund, { type: "actions", elements: actions }],
		},
	];
}

/** Needs a decision: red first, then the oldest deadline, 12 at a time from `start`, up to item 60. */
async function reviewBlocks(ctx: PluginContext, total: number, start: number): Promise<Block[]> {
	if (total === 0) return [];
	const all: Invoice[] = [];
	let cursor: string | undefined;
	for (let page = 0; page < REVIEW_SCAN_PAGES; page++) {
		const r = await invoices(ctx).query({ where: { status: "review" }, orderBy: { expiresAt: "asc" }, limit: 100, ...(cursor ? { cursor } : {}) });
		all.push(...r.items.map((i) => i.data));
		if (!r.hasMore || !r.cursor) break;
		cursor = r.cursor;
	}
	const ordered = [...all.filter(isRed), ...all.filter((inv) => !isRed(inv))];
	const reachable = Math.min(total, REVIEW_MAX, ordered.length);
	const from = start < reachable ? start : 0;
	const page = ordered.slice(from, Math.min(from + REVIEW_STEP, reachable));
	const blocks: Block[] = [{ type: "divider" }, { type: "header", text: `Needs a decision (${total})` }];
	if (total > REVIEW_STEP) blocks.push({ type: "context", text: `Showing ${from + 1}–${from + page.length} of ${total}.` });
	blocks.push(...page.flatMap(reviewItem));
	const end = from + page.length;
	const nav: Block[] = [];
	if (from > 0) nav.push({ type: "button", action_id: "review_page", label: `Back to the first ${REVIEW_STEP}`, value: { start: 0 } });
	if (end < reachable) nav.push({ type: "button", action_id: "review_page", label: `Show the next ${REVIEW_STEP} (${total - end} more)`, value: { start: end } });
	if (nav.length > 0) blocks.push({ type: "actions", block_id: "review_nav", elements: nav });
	if (end >= reachable && total > end)
		blocks.push({ type: "context", text: GOODS_ENABLED ? `${total - end} more are in All invoices below, marked Needs decision.` : `${total - end} more are waiting. Decide the ones above to see them.` });
	return blocks;
}

/** "verb:invoice", then "|cursor" when the invoice was on a later page, so the page stays put after the action. */
const ACTION_VALUE = /^(settle|expire|raise):(inv_[A-Za-z0-9_]{1,40})(?:\|([^\n]{1,1000}))?$/;

interface ActionResult {
	toast: Toast;
	/** The invoice acted on, opened on the next page whether the action applied or was refused. */
	acted?: string;
	cursor?: string;
}

/** An invoice action, re-checked against the invoice as stored now and written only if it hasn't changed since read. */
async function invoiceAction(ctx: PluginContext, value: unknown, now: number): Promise<ActionResult> {
	const m = typeof value === "string" ? ACTION_VALUE.exec(value) : null;
	if (!m) return { toast: { type: "error", message: "That action isn't available." } };
	const verb = m[1] as Verb;
	const back = m[3] ? { cursor: m[3] } : {};
	const current = await invoices(ctx).getVersioned(m[2]);
	if (!current || !current.value) return { toast: { type: "error", message: "That invoice wasn't found." }, ...back };
	const inv = current.value;
	const at = { acted: inv.id, ...back };
	if (!allowed(inv).includes(verb)) {
		if (verb === "raise" && isOpen(inv) && !inv.adminFinal) return { toast: { type: "error", message: `This invoice already needs ${inv.required} confirmations; it can't go higher.` }, ...at };
		return { toast: { type: "error", message: `This invoice changed since the page loaded (it's now ${statusText(inv).toLowerCase()}). Nothing was changed.` }, ...at };
	}
	const next: Invoice = structuredClone(inv);
	let message: string;
	if (verb === "raise") {
		next.required = MAX_REQUIRED;
		message = `This invoice now needs ${MAX_REQUIRED} confirmations.`;
	} else {
		next.status = verb === "settle" ? "settled" : "expired";
		next.adminFinal = true;
		next.finalAt ??= now;
		if (verb === "settle") next.settledAt ??= now;
		delete next.reviewReason;
		delete next.pendingExpiry;
		delete next.reconfirmingSince;
		message = verb === "settle" ? "Marked settled. The invoice won't change again." : "Expired. The invoice won't change again.";
	}
	const write = await invoices(ctx).compareAndSet(inv.id, current.revision, next);
	if (!write.applied) return { toast: { type: "error", message: "This invoice changed while you were deciding (a sync came in). Nothing was changed; look again and retry." }, ...at };
	ctx.log.info("invoice admin action", { invoiceId: inv.id, action: verb, from: inv.status, to: next.status });
	return { toast: { type: "success", message }, ...at };
}

interface PageOptions {
	/** The admin request's Origin header, for the wallet host's address when EmDash's saved one can't be used. */
	origin?: string;
	shownCode?: { code: string; expiresAt: number };
	/** The invoice list's page (a storage cursor); the newest page when absent. */
	cursor?: string;
	/** The invoice just acted on, shown open. */
	acted?: string;
	/** The first review item shown (0, 12, 24, 36 or 48). */
	reviewStart?: number;
}

const PAIRED_WARNING = "A wallet host is already paired. Pairing a new one replaces it, and the current one stops syncing.";
const CONNECT_HINT = "Use this to move, rebuild or replace your wallet host. It creates a one-time code (15 minutes) and the install command.";

/**
 * Connect wallet host's contents. Before setup: the code and commands when just made (or the notes), the site line,
 * the warning, the button. After setup, in Settings: the button, its hint, the site line, then the code and commands
 * (Wyatt, round 2, change 3).
 */
async function connectBlocks(ctx: PluginContext, h: Health, now: number, afterSetup: boolean, shownCode?: PageOptions["shownCode"], origin?: string): Promise<Block[]> {
	const where = walletHostSite(ctx.site.url, origin);
	const siteUrl = where.url ?? "";
	const site = siteBlocks(where);
	const code: Block[] = [];
	if (siteUrl && shownCode) code.push(...installBlocks(siteUrl, shownCode.code, shownCode.expiresAt, now));
	else if (siteUrl) {
		const pairing = await ctx.kv.get<PairingState>(KV.pairing);
		if (isPairingActive(pairing, now)) code.push({ type: "context", text: `A pairing code is active until ${utc(pairing.expiresAt)} (${minutesLeft(pairing.expiresAt, now)} min left). Codes are shown once; press the button for a new one (it replaces the old code).` });
		else if (!afterSetup) code.push({ type: "context", text: "Creates a one-time code (15 minutes) and the install command for your wallet host." });
	}
	const last = await ctx.kv.get<{ at: number; replaced: boolean }>(KV.lastPairing);
	const paired: Block[] = last && now - last.at < LATE_WINDOW_MS ? [{ type: "context", text: `Wallet host paired at ${utc(last.at)}${last.replaced ? ", replacing the previous one, which no longer syncs" : ""}.` }] : [];
	const button: Block = { type: "actions", elements: [{ type: "button", action_id: "connect_wallet_host", label: h.paired ? "Connect a new wallet host" : "Connect wallet host", style: "primary" }] };
	if (afterSetup) {
		// No confirmation dialog (EmDash 1.1.0's has no padding): making a code unpairs nothing, so the hint says it instead.
		const hint = h.paired ? `${CONNECT_HINT} When the new one pairs, the current wallet host stops syncing.` : CONNECT_HINT;
		return [button, { type: "context", text: hint }, ...site, ...code, ...paired];
	}
	return [...(siteUrl ? [] : site), ...code, ...paired, ...(siteUrl ? site : []), ...(h.paired ? [{ type: "context", text: PAIRED_WARNING }] : []), button];
}

/**
 * The page (Wyatt, 2026-10-09). Before setup: banners, checklist, Connect wallet host, Health, invoices, Settings. After
 * setup: banners, Health, invoices, Settings, with Connect a new wallet host in the open in Settings and the checklist
 * as a closed toggle last (round 2, change 3).
 */
async function page(ctx: PluginContext, now: number, opts: PageOptions = {}): Promise<Block[]> {
	const h = await health(ctx, now, { checkRate: true });
	const setup = await setupSection(ctx, h, now, opts.shownCode !== undefined);
	const connect = await connectBlocks(ctx, h, now, setup.done, opts.shownCode, opts.origin);
	const blocks: Block[] = [{ type: "header", text: "Monero payments" }, ...bannerBlocks(h), ...setup.recentTip];
	if (!setup.done) blocks.push(setup.toggle, { type: "divider" }, { type: "header", text: "Connect wallet host" }, ...connect);
	// All invoices (products) only with goods on: the release-1 switch, spec change 22.
	blocks.push(...healthBlocks(h), ...(await reviewBlocks(ctx, h.review, opts.reviewStart ?? 0)), ...(GOODS_ENABLED ? await invoiceBlocks(ctx, now, opts) : []));

	const currency = await ctx.settings.get<string>(SETTING.currency);
	const speed = await ctx.settings.get<string>(SETTING.speed);
	const key = await ctx.settings.get<string>(SETTING.publicKey);
	blocks.push(
		{ type: "divider" },
		{ type: "header", text: "Settings" },
		{
			type: "form",
			block_id: "settings",
			fields: [
				{ type: "select", action_id: "currency", label: "Currency", options: CURRENCIES.map((c) => ({ label: c, value: c })), initial_value: isCurrency(currency) ? currency : "USD" },
				{ type: "select", action_id: "speed", label: "Confirmation speed", options: (Object.keys(PRESETS) as Speed[]).map((s) => ({ label: SPEED_LABELS[s], value: s })), initial_value: isSpeed(speed) ? speed : "standard" },
			],
			submit: { label: "Save", action_id: "save_settings" },
		},
		{ type: "context", text: "Changes apply to new invoices only. Tiers are for orders under 100, 100 to 1,000, and over 1,000 in your currency." },
		{ type: "fields", block_id: "bridge_key", fields: [{ label: "Bridge public key", value: key ?? "Not paired" }] },
		{ type: "context", text: "Filled in by pairing, the only way to set it. It's a public key, not a secret. On the wallet host, xmr-bridge status prints the same key." },
	);
	if (setup.done) blocks.push(...connect, setup.toggle);
	return blocks;
}

async function widget(ctx: PluginContext, now: number): Promise<Block[]> {
	// No price request from the dashboard: the widget loads often, and the page checks the feed.
	const h = await health(ctx, now, { checkRate: false });
	const worst = problems(h).find((p) => p.variant === "error");
	const reviews = h.review > 0 ? ` ${plural(h.review, "review item", "review items")}.` : "";
	const line = !h.paired
		? "Not set up: connect a wallet host on the Monero payments page."
		: worst
			? `${worst.title}.${reviews}`
			: h.lastSyncAgo === null
				? `Wallet host paired but not syncing yet.${reviews}`
				: `Healthy: last sync ${ago(h.lastSyncAgo)}, ${h.free} of ${POOL_TARGET} payment addresses ready.${reviews}`;
	return [{ type: "context", text: line }];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export async function handleAdmin(ctx: PluginContext, input: unknown, now: number, origin?: string): Promise<AdminResponse> {
	const view = (opts: PageOptions = {}) => page(ctx, now, { ...opts, origin });
	// Config-managed installs get neither plugin:install nor plugin:activate, so an admin load schedules the cron.
	if (!(await ctx.kv.get<boolean>(KV.cronScheduled))) await ensureCron(ctx);
	const i = isObject(input) ? input : {};

	if (i.type === "page_load" && i.page === WIDGET) return { blocks: await widget(ctx, now) };
	if (i.type === "form_submit" && i.action_id === "save_settings") {
		const values = isObject(i.values) ? i.values : {};
		if (!isCurrency(values.currency) || !isSpeed(values.speed)) {
			return { blocks: await view(), toast: { message: "Choose a currency and a confirmation speed from the lists.", type: "error" } };
		}
		await ctx.settings.set(SETTING.currency, values.currency);
		await ctx.settings.set(SETTING.speed, values.speed);
		return { blocks: await view(), toast: { message: "Settings saved. They apply to new invoices.", type: "success" } };
	}
	if (i.type === "block_action" && i.action_id === "connect_wallet_host") {
		if (walletHostSite(ctx.site.url, origin).url === null) return { blocks: await view(), toast: { message: "Open this page at your site's public https address first.", type: "error" } };
		// A new code replaces the stored hash, so any earlier code stops working at once.
		const { code, state } = await newPairingCode(now);
		await ctx.kv.set(KV.pairing, state);
		return { blocks: await view({ shownCode: { code, expiresAt: now + PAIRING_TTL_MS } }), toast: { message: "Pairing code created. It works once, for 15 minutes.", type: "success" } };
	}
	if (i.type === "block_action" && i.action_id === "get_test_address") {
		const toast = await testAddress(ctx, now);
		return { blocks: await view(), toast };
	}
	if (i.type === "block_action" && i.action_id === "invoices_page") {
		const v = isObject(i.value) ? i.value : {};
		const cursor = typeof v.cursor === "string" && v.cursor.length > 0 && v.cursor.length <= 1000 ? v.cursor : undefined;
		return { blocks: await view(cursor ? { cursor } : {}) };
	}
	if (i.type === "block_action" && i.action_id === "invoices_newest") return { blocks: await view() };
	if (i.type === "block_action" && i.action_id === "check_again") return { blocks: await view() };
	if (i.type === "block_action" && i.action_id === "review_page") {
		const v = isObject(i.value) ? i.value : {};
		const n = typeof v.start === "number" && Number.isFinite(v.start) ? Math.floor(v.start / REVIEW_STEP) * REVIEW_STEP : 0;
		return { blocks: await view({ reviewStart: Math.min(REVIEW_MAX - REVIEW_STEP, Math.max(0, n)) }) };
	}
	if (i.type === "block_action" && i.action_id === "invoice_action") {
		const r = await invoiceAction(ctx, i.value, now);
		return { blocks: await view({ ...(r.cursor ? { cursor: r.cursor } : {}), ...(r.acted ? { acted: r.acted } : {}) }), toast: r.toast };
	}
	if (i.type === "page_load" || i.type === undefined) return { blocks: await view() };
	return { blocks: await view(), toast: { message: "That action isn't available.", type: "error" } };
}
