/**
 * Where Coffer keeps things (docs/spec.md, Plugin manifest and Security model):
 * - ctx.settings: the bridge's public key, the currency and the confirmation speed (no secret fields).
 * - ctx.kv: pairing state (a hash, never the code), the bridge's last sync, alerts, housekeeping cursors.
 * - ctx.storage: the address pool and the invoices.
 */
import type { StorageCollection } from "emdash";
import type { PluginContext } from "emdash/plugin";

import { LATE_WINDOW_MS, TIP_WATCH_MS } from "./core/constants";
import type { Invoice } from "./core/invoice";
import { CURRENCIES, rateCacheKey } from "./rates";
import type { BridgeState, SyncStore } from "./sync/handle";
import type { PairingState } from "./sync/pairing";

export const SETTING = { publicKey: "bridgePublicKey", currency: "currency", speed: "speed" } as const;
export const KV = { pairing: "state:pairing", bridge: "state:bridge", alerts: "state:alerts", purgeCursor: "state:purgeCursor", cronScheduled: "state:cronScheduled", salt: "state:salt", buckets: "state:buckets", paidTop: "state:paidTop", clientIp: "state:clientIp", lastPairing: "state:lastPairing", setupDone: "state:setupDone", watchTruncatedAt: "state:watchTruncatedAt" } as const;

export interface PoolRow {
	addrIndex: number;
	address: string;
	status: "free" | "claimed";
	invoiceId?: string;
}

/** Storage pages are at most 100 items. */
const PAGE = 100;
/**
 * A scan's safety cap: 200 pages, 20,000 rows. The spam cap allows about 40 invoices every 30 minutes, and tips stay
 * candidates for 8 days, so about 15,400 rows at the most. Reaching it is reported, never silent (spec change 35,
 * condition 2: the scan used to stop at 10 pages without a word, on Node too). Release 1 runs on Node only, where a
 * 15,000-row scan took about 0.2 s; the planned KV watch index (spec change 35, A) replaces the scan.
 */
export const MAX_SCAN_PAGES = 200;

export const pool = (ctx: PluginContext) => ctx.storage.pool as StorageCollection<PoolRow>;
export const invoices = (ctx: PluginContext) => ctx.storage.invoices as StorageCollection<Invoice>;

/** Every page of a query, up to `maxPages`; `truncated` when rows were left unread. */
export async function collect(col: StorageCollection<Invoice>, where: Record<string, unknown>, maxPages: number = MAX_SCAN_PAGES): Promise<{ items: Invoice[]; truncated: boolean }> {
	const items: Invoice[] = [];
	let cursor: string | undefined;
	for (let page = 0; page < maxPages; page++) {
		const r = await col.query({ where: where as never, limit: PAGE, ...(cursor ? { cursor } : {}) });
		for (const item of r.items) items.push(item.data);
		if (!r.hasMore || !r.cursor) return { items, truncated: false };
		cursor = r.cursor;
	}
	return { items, truncated: true };
}

export class CtxSyncStore implements SyncStore {
	constructor(private readonly ctx: PluginContext) {}

	getPublicKey() {
		return this.ctx.settings.get<string>(SETTING.publicKey);
	}
	setPublicKey(publicKey: string) {
		return this.ctx.settings.set(SETTING.publicKey, publicKey);
	}
	getPairing() {
		return this.ctx.kv.get<PairingState>(KV.pairing);
	}
	setPairing(state: PairingState) {
		return this.ctx.kv.set(KV.pairing, state);
	}
	getBridgeState() {
		return this.ctx.kv.get<BridgeState>(KV.bridge);
	}
	setBridgeState(state: BridgeState) {
		return this.ctx.kv.set(KV.bridge, state);
	}
	async notePaid(index: number) {
		const top = await this.ctx.kv.get<number>(KV.paidTop);
		if (top === null || index > top) await this.ctx.kv.set(KV.paidTop, index);
	}
	poolHas(index: number) {
		return pool(this.ctx).exists(String(index));
	}
	async poolAdd(row: { addrIndex: number; address: string }) {
		// Create only when absent: a concurrent sync must never reset a claimed row to free.
		await pool(this.ctx).compareAndSet(String(row.addrIndex), null, { ...row, status: "free" });
	}
	poolFreeCount() {
		return pool(this.ctx).count({ status: "free" });
	}
	async poolTop() {
		const top = await pool(this.ctx).query({ orderBy: { addrIndex: "desc" }, limit: 1 });
		return top.items[0]?.data.addrIndex ?? 0;
	}
	async invoiceForIndex(index: number) {
		const row = await pool(this.ctx).get(String(index));
		return row?.invoiceId ? invoices(this.ctx).get(row.invoiceId) : null;
	}
	saveInvoice(inv: Invoice) {
		return invoices(this.ctx).put(inv.id, inv);
	}
	async watchCandidates(now: number) {
		const col = invoices(this.ctx);
		const open = await collect(col, { status: { in: ["new", "seen", "confirming"] } });
		// Final invoices can be watched for at most a day after expiry (late window) or after settling (settled
		// within a day of expiry at the latest), so two days back covers them.
		const recent = await collect(col, { expiresAt: { gte: now - 2 * LATE_WINDOW_MS } });
		// Tips stay watched for 7 days after their window (spec change 33): their own lookback, on the kind+createdAt index.
		const tips = await collect(col, { kind: "tip", createdAt: { gte: now - TIP_WATCH_MS - LATE_WINDOW_MS } });
		if (open.truncated || recent.truncated || tips.truncated) await this.ctx.kv.set(KV.watchTruncatedAt, now);
		const byId = new Map<string, Invoice>();
		for (const inv of [...open.items, ...recent.items, ...tips.items]) byId.set(inv.id, inv);
		return [...byId.values()];
	}
}

/** plugin:uninstall with deleteData: the pool, the invoices, Coffer's KV state and its settings (the bridge key too). */
export async function deletePluginData(ctx: PluginContext): Promise<void> {
	for (const col of [pool(ctx), invoices(ctx)] as Array<StorageCollection<unknown>>) {
		for (let page = 0; page < 1000; page++) {
			const r = await col.query({ limit: PAGE });
			if (r.items.length === 0) break;
			await col.deleteMany(r.items.map((i) => i.id));
		}
	}
	for (const key of Object.values(KV)) await ctx.kv.delete(key);
	for (const c of CURRENCIES) await ctx.kv.delete(rateCacheKey(c));
	for (const key of Object.values(SETTING)) await ctx.settings.delete(key);
}

