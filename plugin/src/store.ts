/**
 * Where xmr-pay keeps things (docs/spec.md, Plugin manifest and Security model):
 * - ctx.settings: the bridge's public key, the currency and the confirmation speed (no secret fields).
 * - ctx.kv: pairing state (a hash, never the code), the bridge's last sync, alerts, housekeeping cursors.
 * - ctx.storage: the address pool and the invoices.
 */
import type { StorageCollection } from "emdash";
import type { PluginContext } from "emdash/plugin";

import { LATE_WINDOW_MS } from "./core/constants";
import type { Invoice } from "./core/invoice";
import { CURRENCIES, rateCacheKey } from "./rates";
import type { BridgeState, SyncStore } from "./sync/handle";
import type { PairingState } from "./sync/pairing";

export const SETTING = { publicKey: "bridgePublicKey", currency: "currency", speed: "speed" } as const;
export const KV = { pairing: "state:pairing", bridge: "state:bridge", alerts: "state:alerts", purgeCursor: "state:purgeCursor", cronScheduled: "state:cronScheduled", salt: "state:salt", buckets: "state:buckets" } as const;

export interface PoolRow {
	addrIndex: number;
	address: string;
	status: "free" | "claimed";
	invoiceId?: string;
}

/** Storage pages are at most 100 items; every scan here is bounded. */
const PAGE = 100;
const MAX_PAGES = 10;

export const pool = (ctx: PluginContext) => ctx.storage.pool as StorageCollection<PoolRow>;
export const invoices = (ctx: PluginContext) => ctx.storage.invoices as StorageCollection<Invoice>;

async function collect(col: StorageCollection<Invoice>, where: Record<string, unknown>): Promise<Invoice[]> {
	const out: Invoice[] = [];
	let cursor: string | undefined;
	for (let page = 0; page < MAX_PAGES; page++) {
		const r = await col.query({ where: where as never, limit: PAGE, ...(cursor ? { cursor } : {}) });
		for (const item of r.items) out.push(item.data);
		if (!r.hasMore || !r.cursor) break;
		cursor = r.cursor;
	}
	return out;
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
	setBridgeState(state: BridgeState) {
		return this.ctx.kv.set(KV.bridge, state);
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
		const byId = new Map<string, Invoice>();
		for (const inv of [...open, ...recent]) byId.set(inv.id, inv);
		return [...byId.values()];
	}
}

/** plugin:uninstall with deleteData: the pool, the invoices, xmr-pay's KV state and its settings (the bridge key too). */
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

