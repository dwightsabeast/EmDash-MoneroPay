/**
 * The minimal admin route (phase 02 session 2e): settings and Connect wallet host. Block Kit as plain JSON objects
 * (CLAUDE.md, "Dependency tiers"). The full admin page (checklist, health, review queue, invoices) is phase 04.
 */
import type { PluginContext } from "emdash/plugin";

import { PRESETS, type Speed } from "./core/constants";
import { ensureCron } from "./housekeeping";
import { CURRENCIES, isCurrency } from "./rates";
import { KV, SETTING, pool } from "./store";
import type { BridgeState } from "./sync/handle";
import { type PairingState, PAIRING_TTL_MS, isPairingActive, newPairingCode } from "./sync/pairing";
import { POOL_TARGET } from "./sync/protocol";

/** The release host arrives in phase 09. ".invalid" never resolves, so a copied command fails instead of running. */
export const INSTALL_URL = "https://REPLACE-RELEASE-HOST.invalid/install.sh";
export const SILENT_MS = 5 * 60_000;
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
	silentFor: number | null;
}

async function health(ctx: PluginContext, now: number): Promise<Health> {
	const paired = Boolean(await ctx.settings.get<string>(SETTING.publicKey));
	const bridge = await ctx.kv.get<BridgeState>(KV.bridge);
	const free = await pool(ctx).count({ status: "free" });
	// The silent-bridge flag is worked out here, when the admin page or widget loads (spec change 2).
	const silentFor = paired && (!bridge || now - bridge.lastSyncAt > SILENT_MS) ? (bridge ? now - bridge.lastSyncAt : null) : null;
	return { paired, bridge, free, silentFor };
}

function installBlocks(siteUrl: string, code: string, expiresAt: number): Block[] {
	return [
		{ type: "banner", variant: "default", title: "Pairing code ready", description: `It works once, until ${utc(expiresAt)}. Run one of these on your wallet host (a Linux machine, not your site's server).` },
		{ type: "code", language: "bash", code: `curl -fsSL ${INSTALL_URL} | sh -s -- --site ${siteUrl} --pair ${code}` },
		{ type: "context", text: "Cautious path, if the bridge is already installed: download and verify it first, then run:" },
		{ type: "code", language: "bash", code: `xmr-bridge install --site ${siteUrl} --pair ${code}` },
	];
}

async function page(ctx: PluginContext, now: number, shownCode?: { code: string; expiresAt: number }): Promise<Block[]> {
	const h = await health(ctx, now);
	const blocks: Block[] = [{ type: "header", text: "Monero payments" }];
	if (h.silentFor !== null || (h.paired && !h.bridge)) {
		blocks.push({
			type: "banner",
			variant: "alert",
			title: h.bridge ? `Wallet host silent for ${Math.floor((h.silentFor ?? 0) / 60_000)} min` : "Wallet host paired but not syncing yet",
			description: "On the wallet host, run: xmr-bridge status",
		});
	}
	if (h.bridge?.outdated) blocks.push({ type: "banner", variant: "default", title: "Wallet host update available", description: "On the wallet host, run: xmr-bridge update" });
	blocks.push({
		type: "fields",
		fields: [
			{ label: "Wallet host", value: h.paired ? "Paired" : "Not paired" },
			{ label: "Last sync", value: h.bridge ? ago(now - h.bridge.lastSyncAt) : "Never" },
			{ label: "Free addresses", value: `${h.free} of ${POOL_TARGET}` },
		],
	});

	blocks.push({ type: "divider" }, { type: "header", text: "Connect wallet host" });
	if (shownCode) {
		const siteUrl = ctx.site.url || ctx.url("/").replace(/\/$/, "");
		blocks.push(...installBlocks(siteUrl, shownCode.code, shownCode.expiresAt));
	} else {
		const pairing = await ctx.kv.get<PairingState>(KV.pairing);
		if (isPairingActive(pairing, now)) blocks.push({ type: "context", text: `A pairing code is active until ${utc(pairing.expiresAt)}. Codes are shown once; press the button for a new one (it replaces the old code).` });
		else blocks.push({ type: "context", text: "Creates a one-time code (15 minutes) and the install command for your wallet host." });
	}
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

	const currency = await ctx.settings.get<string>(SETTING.currency);
	const speed = await ctx.settings.get<string>(SETTING.speed);
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
	);
	return blocks;
}

async function widget(ctx: PluginContext, now: number): Promise<Block[]> {
	const h = await health(ctx, now);
	const line = !h.paired
		? "Not set up: connect a wallet host on the Monero payments page."
		: h.silentFor !== null || !h.bridge
			? "Wallet host silent: on the wallet host, run xmr-bridge status."
			: `Healthy: last sync ${ago(now - h.bridge.lastSyncAt)}, ${h.free} free addresses.`;
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
		const { code, state } = await newPairingCode(now);
		await ctx.kv.set(KV.pairing, state);
		return { blocks: await page(ctx, now, { code, expiresAt: now + PAIRING_TTL_MS }), toast: { message: "Pairing code created. It works once, for 15 minutes.", type: "success" } };
	}
	if (i.type === "page_load" || i.type === undefined) return { blocks: await page(ctx, now) };
	return { blocks: await page(ctx, now), toast: { message: "That action isn't available.", type: "error" } };
}
