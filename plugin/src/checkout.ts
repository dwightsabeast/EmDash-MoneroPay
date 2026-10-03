/**
 * POST checkout (docs/spec.md, API contracts): a product invoice. The client sends only the product's id or slug;
 * the price comes from the entry, the rate from the price APIs, the address from the pool.
 */
import type { PluginContext } from "emdash/plugin";

import { type Speed, PRESETS } from "./core/constants";
import { type Invoice, newInvoice } from "./core/invoice";
import { atomicToXmr, priceToMinor } from "./core/money";
import { type Currency, getRate, isCurrency } from "./rates";
import { KV, SETTING, invoices, pool } from "./store";
import type { BridgeState } from "./sync/handle";

export type CheckoutErrorCode = "INVALID_REQUEST" | "PRODUCT_NOT_FOUND" | "RATE_UNAVAILABLE" | "NO_ADDRESS_AVAILABLE" | "TOO_MANY_OPEN";
export type CheckoutResponse =
	| { token: string; address: string; amountAtomic: string; amountXmr: string; uri: string; expiresAt: string; status: "new" }
	| { error: { code: CheckoutErrorCode } };

/** Open invoices across the site, well below the pool target (50), so one client can't drain the pool (spec change 4). */
export const MAX_OPEN_TOTAL = 40;
/** Per hashed client, only when the site passes client IPs. */
export const MAX_PER_CLIENT = 5;
const BUCKET_WINDOW_MS = 30 * 60_000;
const MAX_BUCKETS = 500;
const CLAIM_ATTEMPTS = 10;
const BLOCK_MS = 120_000;

const fail = (code: CheckoutErrorCode): CheckoutResponse => ({ error: { code } });
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export interface CheckoutInput {
	product: string;
	email?: string;
	refundAddress?: string;
}

/** Hand-written validation. Unknown fields (a client-sent price or amount included) are ignored, never trusted. */
export function validateCheckout(body: unknown): CheckoutInput | null {
	if (!isObject(body) || body.kind !== "product") return null; // tips and orders come in phases 07 and 08
	if (typeof body.product !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(body.product)) return null;
	const out: CheckoutInput = { product: body.product };
	if (body.email !== undefined && body.email !== "") {
		if (typeof body.email !== "string" || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) return null;
		out.email = body.email;
	}
	if (body.refundAddress !== undefined && body.refundAddress !== "") {
		if (typeof body.refundAddress !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{95}(?:[1-9A-HJ-NP-Za-km-z]{11})?$/.test(body.refundAddress)) return null;
		out.refundAddress = body.refundAddress;
	}
	return out;
}

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Short-lived hashed buckets: a per-site salt in KV, never a raw IP. */
async function clientBucket(ctx: PluginContext, ip: string, now: number) {
	let salt = await ctx.kv.get<string>(KV.salt);
	if (!salt) {
		salt = hex(crypto.getRandomValues(new Uint8Array(16)));
		await ctx.kv.set(KV.salt, salt);
	}
	const key = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}|${ip}`)))).slice(0, 16);
	const all = (await ctx.kv.get<Record<string, number[]>>(KV.buckets)) ?? {};
	for (const k of Object.keys(all)) {
		all[k] = all[k].filter((t) => now - t < BUCKET_WINDOW_MS);
		if (all[k].length === 0) delete all[k];
	}
	return { key, all, count: all[key]?.length ?? 0 };
}

/** Slug lookups scan published products page by page; bounded so a request's work stays small. */
const SLUG_SCAN_PAGES = 10;

/**
 * By entry id (ctx.content.get takes ids only), else by slug among published products. EmDash 1.1.0's plugin content
 * API can't filter by slug, so slugs are matched in memory over at most SLUG_SCAN_PAGES pages of 100.
 */
async function findProduct(ctx: PluginContext, idOrSlug: string) {
	const content = ctx.content;
	if (!content) return null;
	const byId = await content.get("products", idOrSlug).catch(() => null);
	if (byId) return byId;
	let cursor: string | undefined;
	for (let page = 0; page < SLUG_SCAN_PAGES; page++) {
		const r = await content.list("products", { where: { status: "published" }, limit: 100, ...(cursor ? { cursor } : {}) }).catch(() => null);
		const hit = r?.items.find((item) => item.slug === idOrSlug);
		if (hit) return hit;
		if (!r?.hasMore || !r.cursor) return null;
		cursor = r.cursor;
	}
	return null;
}

/** Claims a free pool row with updateIf (one winner per row), then stores the invoice; `subaddress` is unique on invoices. */
async function claimAndStore(ctx: PluginContext, build: (row: { addrIndex: number; address: string }) => Invoice): Promise<Invoice | null> {
	for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt++) {
		const free = await pool(ctx).query({ where: { status: "free" }, orderBy: { addrIndex: "asc" }, limit: 5 });
		if (free.items.length === 0) return null;
		const pick = free.items[attempt % free.items.length];
		const inv = build(pick.data);
		try {
			const claimed = await pool(ctx).updateIf(pick.id, { where: { status: "free" }, set: { status: "claimed", invoiceId: inv.id } });
			if (!claimed.applied) continue; // lost the race: try another row
		} catch {
			continue; // serialization failure: retry, bounded
		}
		try {
			await invoices(ctx).put(inv.id, inv);
			return inv;
		} catch {
			// The database refused the invoice (for example an address already used: subaddress is unique). The row stays
			// claimed so it is never handed out again; try the next one.
		}
	}
	return null;
}

export async function handleCheckout(ctx: PluginContext, body: unknown, ip: string | null, now: number): Promise<CheckoutResponse> {
	const input = validateCheckout(body);
	if (!input) return fail("INVALID_REQUEST");

	// Spam limits (spec change 4): the site-wide cap always; per-client buckets only when the IP is known.
	const open = await invoices(ctx).count({ status: { in: ["new", "seen", "confirming"] }, expiresAt: { gt: now } });
	if (open >= MAX_OPEN_TOTAL) return fail("TOO_MANY_OPEN");
	const bucket = ip ? await clientBucket(ctx, ip, now) : null;
	if (bucket && bucket.count >= MAX_PER_CLIENT) return fail("TOO_MANY_OPEN");

	const entry = await findProduct(ctx, input.product);
	const fiatMinor = entry && entry.status === "published" ? priceToMinor(entry.data.price) : null;
	if (!entry || fiatMinor === null) return fail("PRODUCT_NOT_FOUND");

	const currencySetting = await ctx.settings.get<string>(SETTING.currency);
	const currency: Currency = isCurrency(currencySetting) ? currencySetting : "USD";
	const speedSetting = await ctx.settings.get<string>(SETTING.speed);
	const speed: Speed = speedSetting !== null && speedSetting in PRESETS ? (speedSetting as Speed) : "standard";
	const rate = await getRate(ctx, currency, now);
	if (!rate) return fail("RATE_UNAVAILABLE");

	// Chain height now: the last sync's height plus the blocks since (if the bridge has been quiet).
	const bridge = await ctx.kv.get<BridgeState>(KV.bridge);
	const chainHeight = bridge ? bridge.height + Math.max(0, Math.floor((now - bridge.lastSyncAt) / BLOCK_MS)) : 0;
	const title = typeof entry.data.title === "string" ? entry.data.title.slice(0, 100) : "Order";

	const inv = await claimAndStore(ctx, (row) =>
		newInvoice({
			id: `inv_${hex(crypto.getRandomValues(new Uint8Array(8)))}`,
			token: base64url(crypto.getRandomValues(new Uint8Array(16))),
			kind: "product",
			fiatMinor,
			currency,
			rate: { minor: rate.minor, source: rate.source },
			speed,
			subaddress: row.address,
			addrIndex: row.addrIndex,
			now,
			chainHeight,
			productRef: { collection: "products", id: entry.id },
			...(input.email || input.refundAddress ? { buyer: { ...(input.email ? { email: input.email } : {}), ...(input.refundAddress ? { refundAddress: input.refundAddress } : {}) } } : {}),
		}),
	);
	if (!inv) return fail("NO_ADDRESS_AVAILABLE");

	if (bucket && ip) {
		(bucket.all[bucket.key] ??= []).push(now);
		const keys = Object.keys(bucket.all);
		for (const k of keys.slice(0, Math.max(0, keys.length - MAX_BUCKETS))) delete bucket.all[k];
		await ctx.kv.set(KV.buckets, bucket.all);
	}

	const amountXmr = atomicToXmr(BigInt(inv.expectedAtomic as string));
	return {
		token: inv.token,
		address: inv.subaddress,
		amountAtomic: inv.expectedAtomic as string,
		amountXmr,
		uri: `monero:${inv.subaddress}?tx_amount=${amountXmr}&tx_description=${encodeURIComponent(title)}`,
		expiresAt: new Date(inv.expiresAt).toISOString(),
		status: "new",
	};
}
