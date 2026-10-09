/**
 * The admin route: the Monero payments page and the dashboard widget (phase 04). Block Kit as plain JSON objects
 * (CLAUDE.md, "Dependency tiers"). Session 4a: the health panel and the widget. Session 4b: the setup checklist with
 * Get a test address, pairing notes, the bridge key. Session 4c: the invoice table and row actions. Session 4d: the
 * review queue, reworked after Wyatt's click-through (2026-10-09) into "Needs a decision", with the page reordered.
 * Settings and Connect wallet host are from phase 02 session 2e.
 */
import type { PluginContext } from "emdash/plugin";

import { MAX_OPEN_TOTAL, checkoutHeight, claimAndStore, newIds } from "./checkout";
import { DUST_ATOMIC, GAP_ALERT, LATE_WINDOW_MS, MAX_REQUIRED, PRESETS, RECONFIRM_BLOCKS, SILENT_MS, type Speed, UNPAID_RUN_ALERT } from "./core/constants";
import { type Invoice, counted, isOpen, newInvoice, totals } from "./core/invoice";
import { atomicToXmr } from "./core/money";
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

interface Health {
	paired: boolean;
	bridge: BridgeState | null;
	free: number;
	/** Set when the wallet host is paired and its last sync is older than SILENT_MS (spec change 2). */
	silentFor: number | null;
	lastSyncAgo: number | null;
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
	// The silent-bridge flag is worked out here, when the admin page or widget loads (spec change 2).
	const silentFor = paired && bridge && now - bridge.lastSyncAt > SILENT_MS ? now - bridge.lastSyncAt : null;
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
	return { paired, bridge, free, silentFor, lastSyncAgo: bridge ? now - bridge.lastSyncAt : null, review, unpaidRun, gap, rate, clientIp };
}

const minorText = (m: bigint) => `${m / 100n}.${(m % 100n).toString().padStart(2, "0")}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Red (error) and amber (alert) lines, worst first, each naming its fix. */
function problems(h: Health): Array<{ variant: "error" | "alert"; title: string; description: string }> {
	const out: ReturnType<typeof problems> = [];
	const checks = h.bridge?.checks;
	if (h.silentFor !== null) out.push({ variant: "error", title: `Wallet host silent for ${Math.floor(h.silentFor / 60_000)} min`, description: "Checkout is paused until it syncs again. On the wallet host, run: xmr-bridge status" });
	if (h.paired && !h.bridge) out.push({ variant: "alert", title: "Wallet host paired but not syncing yet", description: "On the wallet host, run: xmr-bridge status" });
	if (checks?.wallet?.state === "behind") {
		out.push({ variant: "error", title: "The wallet is behind its node", description: `${checks.wallet.detail ?? "The wallet is behind its node"}. It catches up by itself after a restart or an outage; if this stays, run xmr-bridge status on the wallet host.` });
	}
	if (checks?.node?.state === "mismatch") out.push({ variant: "error", title: "The wallet host's node disagrees with a second node", description: checks.node.detail ?? "Payments in the disputed block are held at 0 confirmations. Use your own node, or one you trust" });
	if (h.paired && h.bridge && h.free === 0) out.push({ variant: "error", title: "No payment addresses ready", description: "Checkout can't take payments until the wallet host adds more, which it does at its next sync. If this stays, run xmr-bridge status on the wallet host." });
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
	if (!h.bridge) return "Unknown until the wallet host syncs";
	const w = h.bridge.checks?.wallet;
	if (w?.state === "ok") return `${h.bridge.height}, in step with its node`;
	if (w?.state === "behind") return `${h.bridge.height}: ${w.detail ?? "behind its node"}`;
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
	const r = await invoices(ctx).query({ where: { kind: "tip" }, orderBy: { createdAt: "desc" }, limit: 10 });
	return r.items.map((i) => i.data);
}

const DUST_XMR = atomicToXmr(DUST_ATOMIC);
const tipUri = (address: string) => `monero:${address}?tx_amount=${DUST_XMR}&tx_description=${encodeURIComponent("Coffer test tip")}`;

/**
 * The setup checklist (spec, Install flow step 4), as a toggle: open near the top until a test tip settles, then closed
 * in Settings for good (Wyatt, 2026-10-09).
 */
async function setupSection(ctx: PluginContext, h: Health): Promise<{ done: boolean; toggle: Block }> {
	const tips = await testTips(ctx);
	let done = (await ctx.kv.get<boolean>(KV.setupDone)) === true;
	if (!done && tips.some((t) => t.status === "settled")) {
		done = true;
		await ctx.kv.set(KV.setupDone, true);
	}
	const wallet = h.bridge?.checks?.wallet;
	const synced = h.bridge !== null && h.silentFor === null && wallet?.state !== "behind";
	const rows: Array<[string, boolean, string]> = [
		["Wallet host paired", h.paired, "press Connect wallet host below and run the command on your wallet host."],
		[
			"Wallet synced",
			synced,
			h.silentFor !== null
				? "the wallet host is silent. On the wallet host, run: xmr-bridge status"
				: wallet?.state === "behind"
					? `the wallet is catching up with its node (${wallet.detail ?? "behind"}).`
					: "the wallet host syncs within a minute of pairing.",
		],
		["Payment addresses ready", h.free > 0, "the wallet host adds them at its first sync."],
		["Price feed answering", Boolean(h.rate), "both price services failed just now; this page checks again when it loads."],
		["Test tip received", done, `once the items above are done, press Get a test address and send at least ${DUST_XMR.replace(/0+$/, "")} XMR to it.`],
	];
	const inner: Block[] = [{ type: "fields", fields: rows.map(([label, ok, next]) => ({ label, value: ok ? "Done" : `To do: ${next}` })) }];
	const ready = rows.slice(0, 4).every(([, ok]) => ok);
	if (!done && ready) {
		const open = tips.find((t) => isOpen(t));
		if (open) {
			const t = totals(open);
			inner.push(
				{ type: "section", text: `Send at least ${DUST_XMR.replace(/0+$/, "")} XMR to this address from any wallet. It's a tip to your own shop wallet, so the money stays yours.` },
				{ type: "code", code: open.subaddress },
				{ type: "code", code: tipUri(open.subaddress) },
				{ type: "context", text: open.status === "new" ? `Waiting for the payment (until ${utc(open.expiresAt)}).` : `Payment seen: ${t.depth} of ${open.required} confirmations.` },
			);
		}
		inner.push({ type: "actions", elements: [{ type: "button", action_id: "get_test_address", label: "Get a test address" }] });
	}
	const count = rows.filter(([, ok]) => ok).length;
	return { done, toggle: { type: "accordion", block_id: "setup", label: done ? "Setup (complete)" : `Setup: ${count} of 5 done`, default_open: !done, blocks: inner } };
}

/** Get a test address: an open tip invoice on a pool address, through this private route (phase 07 adds public tips). */
async function testAddress(ctx: PluginContext, now: number): Promise<Toast> {
	if (!(await ctx.settings.get<string>(SETTING.publicKey))) return { type: "error", message: "Connect a wallet host first." };
	const chainHeight = checkoutHeight(await ctx.kv.get<BridgeState>(KV.bridge), now);
	if (chainHeight === null) return { type: "error", message: "The wallet host must be syncing first. On the wallet host, run: xmr-bridge status" };
	if ((await testTips(ctx)).some((t) => isOpen(t))) return { type: "info", message: "Your test address is below." };
	const speedSetting = await ctx.settings.get<string>(SETTING.speed);
	const speed: Speed = isSpeed(speedSetting) ? speedSetting : "standard";
	const currencySetting = await ctx.settings.get<string>(SETTING.currency);
	const inv = await claimAndStore(ctx, (row) =>
		newInvoice({ ...newIds(), kind: "tip", fiatMinor: null, currency: isCurrency(currencySetting) ? currencySetting : "USD", rate: null, speed, subaddress: row.address, addrIndex: row.addrIndex, now, chainHeight }),
	);
	if (!inv) return { type: "error", message: "No payment address is free yet. The wallet host adds them at its next sync; try again in a minute." };
	return { type: "success", message: "Test address ready. Send the test tip from any wallet." };
}

const minutesLeft = (expiresAt: number, now: number) => Math.max(0, Math.floor((expiresAt - now) / 60_000));

function installBlocks(siteUrl: string, code: string, expiresAt: number, now: number): Block[] {
	return [
		{ type: "banner", variant: "default", title: "Pairing code ready", description: `It works once, until ${utc(expiresAt)} (${minutesLeft(expiresAt, now)} min left). Run one of these on your wallet host (a Linux machine, not your site's server).` },
		{ type: "code", language: "bash", code: `curl -fsSL ${INSTALL_URL} | sh -s -- --site ${siteUrl} --pair ${code}` },
		{ type: "context", text: "Cautious path, if the bridge is already installed: download and verify it first, then run:" },
		{ type: "code", language: "bash", code: `xmr-bridge install --site ${siteUrl} --pair ${code}` },
	];
}

const INVOICE_PAGE = 25;
const STATUS_TEXT: Record<Invoice["status"], string> = { new: "New", seen: "Seen", confirming: "Confirming", settled: "Settled", expired: "Expired", review: "Review" };
const statusText = (inv: Invoice) =>
	inv.status === "review" ? `Needs decision: ${inv.reviewReason ?? "review"}` : `${STATUS_TEXT[inv.status]}${inv.adminFinal ? " (by admin)" : ""}`;
const xmr = (atomic: bigint) => (atomic === 0n ? "0" : atomicToXmr(atomic));

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

type Verb = "settle" | "expire" | "raise" | "details";
const VERB_LABELS: Record<Verb, string> = { settle: "Mark settled", expire: "Expire", raise: `Raise confirmations to ${MAX_REQUIRED}`, details: "Details and txids" };

/** What an admin may do to an invoice in its current state. A decision (settle, expire) is final. */
function allowed(inv: Invoice): Verb[] {
	if (inv.adminFinal) return ["details"];
	const out: Verb[] = [];
	if (inv.status !== "settled") out.push("settle");
	if (isOpen(inv) || inv.status === "review") out.push("expire");
	if (isOpen(inv) && inv.required < MAX_REQUIRED) out.push("raise");
	out.push("details");
	return out;
}

function invoiceRow(inv: Invoice): Record<string, unknown> {
	return {
		id: inv.id,
		status: statusText(inv),
		amount: inv.fiat ? `${minorText(BigInt(inv.fiat.amountMinor))} ${inv.fiat.currency}` : "",
		xmr: inv.expectedAtomic ? xmr(BigInt(inv.expectedAtomic)) : "",
		received: xmr(totals(inv).received),
		confirmations: confirmationsText(inv),
		created: new Date(inv.createdAt).toISOString(),
		expires: new Date(inv.expiresAt).toISOString(),
		actions: { type: "menu", action_id: "invoice_action", label: "Actions", items: allowed(inv).map((v) => ({ label: VERB_LABELS[v], value: `${v}:${inv.id}` })) },
	};
}

/** A transfer with why it doesn't count, or "counted". */
function transferNote(t: Invoice["transfers"][number]): string {
	const why = notCountedReasons(t);
	const base = `${atomicToXmr(BigInt(t.amountAtomic))} XMR, ${t.confirmations} confirmations`;
	return why.length === 0 ? `${base}, counted` : `${base}, not counted: ${why.join("; ")}`;
}

/** One invoice's details: buyer-supplied text only as plain text, each txid as copyable text. */
function detailBlocks(inv: Invoice): Block[] {
	const fields = [
		{ label: "Status", value: statusText(inv) },
		{ label: "Amount", value: invoiceRow(inv).amount as string },
		{ label: "Received", value: receivedText(inv) },
		{ label: "Confirmations", value: confirmationsText(inv) },
		{ label: "Payment address", value: `#${inv.addrIndex}: ${inv.subaddress}` },
		...(inv.productRef ? [{ label: "Product", value: inv.productRef.id }] : []),
		...(inv.buyer?.email ? [{ label: "Buyer email", value: inv.buyer.email }] : []),
		...(inv.buyer?.refundAddress ? [{ label: "Refund address", value: inv.buyer.refundAddress }] : []),
		...(inv.buyer?.note ? [{ label: "Note", value: inv.buyer.note }] : []),
	];
	const inner: Block[] = [{ type: "fields", fields }];
	if (inv.productRef) inner.push({ type: "actions", elements: productLink(inv) });
	if (inv.transfers.length === 0) inner.push({ type: "context", text: "No payment reported yet." });
	for (const t of inv.transfers) inner.push({ type: "context", text: transferNote(t) }, { type: "code", code: t.txid });
	return [{ type: "accordion", block_id: "invoice_details", label: `Invoice ${inv.id}`, default_open: true, blocks: inner }];
}

async function invoiceBlocks(ctx: PluginContext, opts: PageOptions): Promise<Block[]> {
	const r = await invoices(ctx).query({ where: { kind: "product" }, orderBy: { createdAt: "desc" }, limit: INVOICE_PAGE, ...(opts.cursor ? { cursor: opts.cursor } : {}) });
	const blocks: Block[] = [{ type: "divider" }, { type: "header", text: "All invoices" }];
	if (opts.details) blocks.push(...detailBlocks(opts.details));
	blocks.push({
		type: "table",
		block_id: "invoices",
		page_action_id: "invoices_page",
		empty_text: "No orders yet.",
		columns: [
			{ key: "status", label: "Status", format: "badge" },
			{ key: "amount", label: "Amount" },
			{ key: "xmr", label: "XMR" },
			{ key: "received", label: "Received" },
			{ key: "confirmations", label: "Confirmations" },
			{ key: "created", label: "Created", format: "relative_time" },
			{ key: "expires", label: "Expires", format: "relative_time" },
			{ key: "actions", label: "", format: "element" },
		],
		rows: r.items.map((i) => invoiceRow(i.data)),
		...(r.hasMore && r.cursor ? { next_cursor: r.cursor } : {}),
	});
	if (opts.cursor) blocks.push({ type: "actions", block_id: "invoices_nav", elements: [{ type: "button", action_id: "invoices_newest", label: "Newest invoices" }] });
	return blocks;
}

/** Review items per page: 12 worst-case items next to a full table and an open Details panel stay under Block Kit's
 * 2,000 nodes (a full 25-row table is about 840; a reversed item with everything about 61). Paged up to item 60, then
 * the rest are pointed at in All invoices (Wyatt, 2026-10-09). */
const REVIEW_STEP = 12;
const REVIEW_MAX = 60;
/** Review invoices read for ordering: red first needs the reason, which has no index (adding one is a stop point). */
const REVIEW_SCAN_PAGES = 5;
const REVIEW_TITLE: Record<NonNullable<Invoice["reviewReason"]>, string> = { late: "Late payment", underpaid: "Underpaid", reorg: "Payment not re-mined after a reorg", reversed: "Settled payment gone" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (ms: number) => `${MONTHS[new Date(ms).getUTCMonth()]} ${new Date(ms).getUTCDate()}`;
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
	// The products table holds product invoices only (tips come with phase 07).
	const rowHint = (accept: string) => (inv.kind === "product" ? ` To accept ${accept} instead, use Mark settled in its row under All invoices below.` : "");
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
		...(inv.buyer?.refundAddress ? [{ label: "Refund address", value: inv.buyer.refundAddress }] : []),
	];
	const amount = inv.fiat ? `${minorText(BigInt(inv.fiat.amountMinor))} ${inv.fiat.currency}` : inv.kind;
	return [
		{ type: "banner", block_id: `review_${inv.id}`, variant: isRed(inv) ? "error" : "alert", title, description: `${inv.id} · ${amount} · created ${shortDate(inv.createdAt)}` },
		{
			type: "accordion",
			block_id: `review_${inv.id}_details`,
			label: "Details and actions",
			default_open: false,
			blocks: [{ type: "section", text: what }, { type: "context", text: advice }, { type: "fields", fields }, { type: "actions", elements: actions }],
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
	if (end >= reachable && total > end) blocks.push({ type: "context", text: `${total - end} more are in All invoices below, marked Needs decision.` });
	return blocks;
}

const ACTION_VALUE = /^(settle|expire|raise|details):(inv_[A-Za-z0-9_]{1,40})$/;

/** A row action, re-checked against the invoice as stored now and written only if it hasn't changed since read. */
async function invoiceAction(ctx: PluginContext, value: unknown, now: number): Promise<{ toast?: Toast; details?: Invoice }> {
	const m = typeof value === "string" ? ACTION_VALUE.exec(value) : null;
	if (!m) return { toast: { type: "error", message: "That action isn't available." } };
	const verb = m[1] as Verb;
	const current = await invoices(ctx).getVersioned(m[2]);
	if (!current || !current.value) return { toast: { type: "error", message: "That invoice wasn't found." } };
	const inv = current.value;
	if (verb === "details") return { details: inv };
	if (!allowed(inv).includes(verb)) {
		if (verb === "raise" && isOpen(inv) && !inv.adminFinal) return { toast: { type: "error", message: `This invoice already needs ${inv.required} confirmations; it can't go higher.` } };
		return { toast: { type: "error", message: `This invoice changed since the page loaded (it's now ${statusText(inv).toLowerCase()}). Nothing was changed.` } };
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
	if (!write.applied) return { toast: { type: "error", message: "This invoice changed while you were deciding (a sync came in). Nothing was changed; look again and retry." } };
	ctx.log.info("invoice admin action", { invoiceId: inv.id, action: verb, from: inv.status, to: next.status });
	return { toast: { type: "success", message } };
}

interface PageOptions {
	shownCode?: { code: string; expiresAt: number };
	/** The invoice table's page (a storage cursor); the newest page when absent. */
	cursor?: string;
	/** An invoice to show in the details panel. */
	details?: Invoice;
	/** The first review item shown (0, 12, 24, 36 or 48). */
	reviewStart?: number;
}

const PAIRED_WARNING = "A wallet host is already paired. Pairing a new one replaces it, and the current one stops syncing.";

/** Connect wallet host's contents: the code and commands when just made, the notes, the warning, the button. */
async function connectBlocks(ctx: PluginContext, h: Health, now: number, shownCode?: PageOptions["shownCode"]): Promise<Block[]> {
	const blocks: Block[] = [];
	// The site URL comes from the site's configuration or the address stored at setup, never from this request.
	const siteUrl = ctx.site.url.replace(/\/$/, "");
	if (!siteUrl) {
		blocks.push({ type: "banner", variant: "error", title: "Your site's address isn't known", description: "Set siteUrl in the site's Astro config (or the EMDASH_SITE_URL environment variable) to its public address, then reload this page." });
	} else if (shownCode) {
		blocks.push(...installBlocks(siteUrl, shownCode.code, shownCode.expiresAt, now));
	} else {
		const pairing = await ctx.kv.get<PairingState>(KV.pairing);
		if (isPairingActive(pairing, now)) blocks.push({ type: "context", text: `A pairing code is active until ${utc(pairing.expiresAt)} (${minutesLeft(pairing.expiresAt, now)} min left). Codes are shown once; press the button for a new one (it replaces the old code).` });
		else blocks.push({ type: "context", text: "Creates a one-time code (15 minutes) and the install command for your wallet host." });
	}
	const last = await ctx.kv.get<{ at: number; replaced: boolean }>(KV.lastPairing);
	if (last && now - last.at < LATE_WINDOW_MS) {
		blocks.push({ type: "context", text: `Wallet host paired at ${utc(last.at)}${last.replaced ? ", replacing the previous one, which no longer syncs" : ""}.` });
	}
	if (siteUrl) blocks.push({ type: "context", text: `The wallet host will connect to ${siteUrl}. If that isn't your site's public address, set siteUrl in the site's Astro config (or EMDASH_SITE_URL) first.` });
	// No confirmation dialog (EmDash 1.1.0's has no padding): making a code unpairs nothing, so the page says it instead.
	if (h.paired) blocks.push({ type: "context", text: PAIRED_WARNING });
	blocks.push({ type: "actions", elements: [{ type: "button", action_id: "connect_wallet_host", label: h.paired ? "Connect a new wallet host" : "Connect wallet host", style: "primary" }] });
	return blocks;
}

/**
 * The page (Wyatt, 2026-10-09). Before setup: banners, checklist, Connect wallet host, Health, invoices, Settings. After
 * setup: banners, Health, invoices, Settings, with the checklist and Connect wallet host as closed toggles in Settings.
 */
async function page(ctx: PluginContext, now: number, opts: PageOptions = {}): Promise<Block[]> {
	const h = await health(ctx, now, { checkRate: true });
	const setup = await setupSection(ctx, h);
	const connect = await connectBlocks(ctx, h, now, opts.shownCode);
	const blocks: Block[] = [{ type: "header", text: "Monero payments" }, ...bannerBlocks(h)];
	if (!setup.done) blocks.push(setup.toggle, { type: "divider" }, { type: "header", text: "Connect wallet host" }, ...connect);
	blocks.push(...healthBlocks(h), ...(await reviewBlocks(ctx, h.review, opts.reviewStart ?? 0)), ...(await invoiceBlocks(ctx, opts)));

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
	if (setup.done) {
		// A new block_id while a code shows: the host keeps each toggle's open state by block_id, so this one opens.
		blocks.push(setup.toggle, { type: "accordion", block_id: opts.shownCode ? "connect_code" : "connect", label: "Connect a new wallet host", default_open: Boolean(opts.shownCode), blocks: connect });
	}
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
			: !h.bridge
				? `Wallet host paired but not syncing yet.${reviews}`
				: `Healthy: last sync ${ago(now - h.bridge.lastSyncAt)}, ${h.free} of ${POOL_TARGET} payment addresses ready.${reviews}`;
	return [{ type: "context", text: line }];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export async function handleAdmin(ctx: PluginContext, input: unknown, now: number): Promise<AdminResponse> {
	// Config-managed installs get neither plugin:install nor plugin:activate, so an admin load schedules the cron.
	if (!(await ctx.kv.get<boolean>(KV.cronScheduled))) await ensureCron(ctx);
	const i = isObject(input) ? input : {};

	if (i.type === "page_load" && i.page === WIDGET) return { blocks: await widget(ctx, now) };
	if (i.type === "form_submit" && i.action_id === "save_settings") {
		const values = isObject(i.values) ? i.values : {};
		if (!isCurrency(values.currency) || !isSpeed(values.speed)) {
			return { blocks: await page(ctx, now), toast: { message: "Choose a currency and a confirmation speed from the lists.", type: "error" } };
		}
		await ctx.settings.set(SETTING.currency, values.currency);
		await ctx.settings.set(SETTING.speed, values.speed);
		return { blocks: await page(ctx, now), toast: { message: "Settings saved. They apply to new invoices.", type: "success" } };
	}
	if (i.type === "block_action" && i.action_id === "connect_wallet_host") {
		if (!ctx.site.url) return { blocks: await page(ctx, now), toast: { message: "Set your site's public address first.", type: "error" } };
		// A new code replaces the stored hash, so any earlier code stops working at once.
		const { code, state } = await newPairingCode(now);
		await ctx.kv.set(KV.pairing, state);
		return { blocks: await page(ctx, now, { shownCode: { code, expiresAt: now + PAIRING_TTL_MS } }), toast: { message: "Pairing code created. It works once, for 15 minutes.", type: "success" } };
	}
	if (i.type === "block_action" && i.action_id === "get_test_address") {
		const toast = await testAddress(ctx, now);
		return { blocks: await page(ctx, now), toast };
	}
	if (i.type === "block_action" && i.action_id === "invoices_page") {
		const v = isObject(i.value) ? i.value : {};
		const cursor = typeof v.cursor === "string" && v.cursor.length > 0 && v.cursor.length <= 1000 ? v.cursor : undefined;
		return { blocks: await page(ctx, now, cursor ? { cursor } : {}) };
	}
	if (i.type === "block_action" && i.action_id === "invoices_newest") return { blocks: await page(ctx, now) };
	if (i.type === "block_action" && i.action_id === "review_page") {
		const v = isObject(i.value) ? i.value : {};
		const n = typeof v.start === "number" && Number.isFinite(v.start) ? Math.floor(v.start / REVIEW_STEP) * REVIEW_STEP : 0;
		return { blocks: await page(ctx, now, { reviewStart: Math.min(REVIEW_MAX - REVIEW_STEP, Math.max(0, n)) }) };
	}
	if (i.type === "block_action" && i.action_id === "invoice_action") {
		const r = await invoiceAction(ctx, i.value, now);
		return { blocks: await page(ctx, now, r.details ? { details: r.details } : {}), ...(r.toast ? { toast: r.toast } : {}) };
	}
	if (i.type === "page_load" || i.type === undefined) return { blocks: await page(ctx, now) };
	return { blocks: await page(ctx, now), toast: { message: "That action isn't available.", type: "error" } };
}
