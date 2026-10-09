/**
 * The admin route: the Monero payments page and the dashboard widget (phase 04). Block Kit as plain JSON objects
 * (CLAUDE.md, "Dependency tiers"). Session 4a: the health panel and the widget. Session 4b: the setup checklist with
 * Get a test address, pairing notes, the bridge key. Settings and Connect wallet host are from phase 02 session 2e.
 */
import type { PluginContext } from "emdash/plugin";

import { MAX_OPEN_TOTAL, checkoutHeight, claimAndStore, newIds } from "./checkout";
import { DUST_ATOMIC, GAP_ALERT, LATE_WINDOW_MS, PRESETS, SILENT_MS, type Speed, UNPAID_RUN_ALERT } from "./core/constants";
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
	if (h.review > 0) out.push({ variant: "alert", title: `${plural(h.review, "invoice needs", "invoices need")} a decision`, description: "Each one shows what happened and a recommended action in the review queue." });
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

/** The setup checklist (spec, Install flow step 4): open until a test tip settles, then collapsed for good. */
async function setupBlocks(ctx: PluginContext, h: Health, now: number): Promise<Block[]> {
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
	return [{ type: "accordion", block_id: "setup", label: done ? "Setup complete" : `Setup: ${count} of 5 done`, default_open: !done, blocks: inner }];
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

async function page(ctx: PluginContext, now: number, shownCode?: { code: string; expiresAt: number }): Promise<Block[]> {
	const h = await health(ctx, now, { checkRate: true });
	const blocks: Block[] = [{ type: "header", text: "Monero payments" }, ...bannerBlocks(h), ...(await setupBlocks(ctx, h, now))];

	blocks.push({ type: "divider" }, { type: "header", text: "Connect wallet host" });
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
	blocks.push({
		type: "actions",
		elements: [
			{
				type: "button",
				action_id: "connect_wallet_host",
				label: h.paired ? "Connect a new wallet host" : "Connect wallet host",
				style: "primary",
				...(h.paired ? { confirm: { title: "Replace the paired wallet host?", text: "When the new wallet host pairs, it replaces the current one, which stops syncing.", confirm: "Create a code", deny: "Cancel" } } : {}),
			},
		],
	});

	blocks.push(...healthBlocks(h));

	const currency = await ctx.settings.get<string>(SETTING.currency);
	const speed = await ctx.settings.get<string>(SETTING.speed);
	const key = await ctx.settings.get<string>(SETTING.publicKey);
	blocks.push(
		{ type: "divider" },
		{ type: "header", text: "Settings" },
		{ type: "fields", block_id: "bridge_key", fields: [{ label: "Bridge public key", value: key ?? "Not paired" }] },
		{ type: "context", text: "Filled in by pairing. It's a public key, not a secret." },
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
	);
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
		return { blocks: await page(ctx, now, { code, expiresAt: now + PAIRING_TTL_MS }), toast: { message: "Pairing code created. It works once, for 15 minutes.", type: "success" } };
	}
	if (i.type === "block_action" && i.action_id === "get_test_address") {
		const toast = await testAddress(ctx, now);
		return { blocks: await page(ctx, now), toast };
	}
	if (i.type === "page_load" || i.type === undefined) return { blocks: await page(ctx, now) };
	return { blocks: await page(ctx, now), toast: { message: "That action isn't available.", type: "error" } };
}
