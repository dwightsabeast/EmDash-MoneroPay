/**
 * POST checkout (docs/spec.md, API contracts): a tip (phase 07, spec change 33) or, with the release-1 switch on, a
 * product invoice. For a product the client sends only its id or slug; the price comes from the entry, the rate from
 * the price APIs, the address from the pool. A tip may carry an amount, an entry and a note.
 */
import type { PluginContext } from "emdash/plugin";

import { ATOMIC_PER_XMR, DUST_ATOMIC, GOODS_ENABLED, type Speed, PRESETS, SILENT_MS } from "./core/constants";
import { type Invoice, newInvoice } from "./core/invoice";
import { atomicToXmr, priceToMinor } from "./core/money";
import { invoiceUri } from "./core/uri";
import { type Currency, getRate, isCurrency } from "./rates";
import { KV, SETTING, invoices, pool } from "./store";
import type { BridgeState } from "./sync/handle";

export type CheckoutErrorCode = "INVALID_REQUEST" | "PRODUCT_NOT_FOUND" | "ENTRY_NOT_FOUND" | "RATE_UNAVAILABLE" | "NO_ADDRESS_AVAILABLE" | "TOO_MANY_OPEN" | "WALLET_HOST_SILENT" | "WALLET_HOST_SYNCING";
/** `amountAtomic` and `amountXmr` are null for an open tip (no amount asked). */
export type CheckoutResponse =
	| { token: string; address: string; amountAtomic: string | null; amountXmr: string | null; uri: string; expiresAt: string; status: "new" }
	| { error: { code: CheckoutErrorCode } };

/** Open invoices across the site, well below the pool target (50), so one client can't drain the pool (spec change 4). */
export const MAX_OPEN_TOTAL = 40;
/** Per hashed client, only when the site passes client IPs. */
export const MAX_PER_CLIENT = 5;
const BUCKET_WINDOW_MS = 30 * 60_000;
const MAX_BUCKETS = 500;
const CLAIM_ATTEMPTS = 10;

/**
 * The chain height an invoice is made at: the last sync's, while the wallet host is not silent and its node has caught
 * up with the network. Otherwise the reason checkout refuses. An expiresHeight that is too low can turn a payment made
 * in time into a late one: an estimate after a silence was 35 blocks low in 3i (spec change 16), and a wallet on a
 * node that's still syncing reports a height far below the real chain (spec change 20).
 */
export function checkoutHeight(bridge: BridgeState | null, now: number): number | "WALLET_HOST_SILENT" | "WALLET_HOST_SYNCING" {
	if (!bridge || bridge.lastSyncAt === undefined || now - bridge.lastSyncAt > SILENT_MS) return "WALLET_HOST_SILENT";
	if (bridge.checks?.wallet?.state === "syncing") return "WALLET_HOST_SYNCING";
	return bridge.height;
}

const fail = (code: CheckoutErrorCode): CheckoutResponse => ({ error: { code } });
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export interface ProductInput {
	kind: "product";
	product: string;
	email?: string;
	refundAddress?: string;
}

export interface TipInput {
	kind: "tip";
	contentRef?: { collection: string; id: string };
	amount?: { fiatMinor: bigint; currency: Currency } | { xmrAtomic: bigint };
	note?: string;
}

export type CheckoutInput = ProductInput | TipInput;

/** A tip's largest fiat amount (10,000.00 in minor units) and XMR amount (1,000 XMR): typos, not limits on generosity. */
export const MAX_TIP_FIAT_MINOR = 1_000_000n;
export const MAX_TIP_ATOMIC = 1000n * ATOMIC_PER_XMR;
/** A tip's note, in characters (code points), after cleaning. */
export const TIP_NOTE_MAX = 140;

const AMOUNT_DIGITS = /^[1-9]\d{0,18}$/;
const COLLECTION = /^[a-z][a-z0-9_]{0,63}$/;
const ENTRY_ID = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * A tip's note as plain text: control characters become spaces, format characters (bidi overrides, zero-width
 * characters) go, runs of whitespace collapse, and the ends are trimmed. Undefined when nothing is left; null when it
 * isn't a string or is longer than TIP_NOTE_MAX.
 */
export function cleanNote(raw: unknown): string | null | undefined {
	if (typeof raw !== "string") return null;
	const note = raw.replace(/\p{Cc}/gu, " ").replace(/\p{Cf}/gu, "").replace(/\s+/g, " ").trim();
	if (note === "") return undefined;
	return [...note].length <= TIP_NOTE_MAX ? note : null;
}

function validateTip(body: Record<string, unknown>): TipInput | null {
	const out: TipInput = { kind: "tip" };
	if (body.contentRef !== undefined) {
		const c = body.contentRef;
		if (!isObject(c) || typeof c.collection !== "string" || !COLLECTION.test(c.collection) || typeof c.id !== "string" || !ENTRY_ID.test(c.id)) return null;
		out.contentRef = { collection: c.collection, id: c.id };
	}
	if (body.amount !== undefined) {
		const a = body.amount;
		if (!isObject(a)) return null;
		const fiat = a.fiatMinor !== undefined;
		const xmr = a.xmrAtomic !== undefined;
		if (fiat === xmr) return null; // exactly one
		if (fiat) {
			if (typeof a.fiatMinor !== "string" || !AMOUNT_DIGITS.test(a.fiatMinor) || !isCurrency(a.currency)) return null;
			const fiatMinor = BigInt(a.fiatMinor);
			if (fiatMinor > MAX_TIP_FIAT_MINOR) return null;
			out.amount = { fiatMinor, currency: a.currency };
		} else {
			if (typeof a.xmrAtomic !== "string" || !AMOUNT_DIGITS.test(a.xmrAtomic)) return null;
			const xmrAtomic = BigInt(a.xmrAtomic);
			if (xmrAtomic < DUST_ATOMIC || xmrAtomic > MAX_TIP_ATOMIC) return null;
			out.amount = { xmrAtomic };
		}
	}
	if (body.note !== undefined) {
		const note = cleanNote(body.note);
		if (note === null) return null;
		if (note !== undefined) out.note = note;
	}
	return out;
}

/** Hand-written validation. Unknown fields (a client-sent price or amount included) are ignored, never trusted. */
export function validateCheckout(body: unknown): CheckoutInput | null {
	if (!isObject(body)) return null;
	if (body.kind === "tip") return validateTip(body);
	// The release-1 switch (spec change 22): with goods off, a product checkout is refused exactly like an unknown kind.
	if (!GOODS_ENABLED || body.kind !== "product") return null; // orders come in phase 08
	if (typeof body.product !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(body.product)) return null;
	const out: ProductInput = { kind: "product", product: body.product };
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

/** A new invoice's id and its status token (the buyer's only handle on it). */
export const newIds = () => ({ id: `inv_${hex(crypto.getRandomValues(new Uint8Array(8)))}`, token: base64url(crypto.getRandomValues(new Uint8Array(16))) });

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
export async function claimAndStore(ctx: PluginContext, build: (row: { addrIndex: number; address: string }) => Invoice): Promise<Invoice | null> {
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

	const speedSetting = await ctx.settings.get<string>(SETTING.speed);
	const speed: Speed = speedSetting !== null && speedSetting in PRESETS ? (speedSetting as Speed) : "standard";
	const currencySetting = await ctx.settings.get<string>(SETTING.currency);
	const siteCurrency: Currency = isCurrency(currencySetting) ? currencySetting : "USD";
	const made = input.kind === "tip" ? await tipInvoice(ctx, input, speed, siteCurrency, now) : await productInvoice(ctx, input, speed, siteCurrency, now);
	if ("error" in made) return made;
	const inv = made;

	// For the admin page: per-visitor limits work only when the site passes client IPs.
	await ctx.kv.set(KV.clientIp, ip !== null);
	if (bucket && ip) {
		(bucket.all[bucket.key] ??= []).push(now);
		const keys = Object.keys(bucket.all);
		for (const k of keys.slice(0, Math.max(0, keys.length - MAX_BUCKETS))) delete bucket.all[k];
		await ctx.kv.set(KV.buckets, bucket.all);
	}

	return {
		token: inv.token,
		address: inv.subaddress,
		amountAtomic: inv.expectedAtomic,
		amountXmr: inv.expectedAtomic !== null ? atomicToXmr(BigInt(inv.expectedAtomic)) : null,
		uri: invoiceUri(inv),
		expiresAt: new Date(inv.expiresAt).toISOString(),
		status: "new",
	};
}

async function productInvoice(ctx: PluginContext, input: ProductInput, speed: Speed, currency: Currency, now: number): Promise<Invoice | { error: { code: CheckoutErrorCode } }> {
	const entry = await findProduct(ctx, input.product);
	const fiatMinor = entry && entry.status === "published" ? priceToMinor(entry.data.price) : null;
	if (!entry || fiatMinor === null) return { error: { code: "PRODUCT_NOT_FOUND" } };

	const chainHeight = checkoutHeight(await ctx.kv.get<BridgeState>(KV.bridge), now);
	if (typeof chainHeight !== "number") return { error: { code: chainHeight } };

	const rate = await getRate(ctx, currency, now);
	if (!rate) return { error: { code: "RATE_UNAVAILABLE" } };

	const title = typeof entry.data.title === "string" ? entry.data.title.slice(0, 100) : "Order";

	const inv = await claimAndStore(ctx, (row) =>
		newInvoice({
			...newIds(),
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
			uriDescription: title,
			...(input.email || input.refundAddress ? { buyer: { ...(input.email ? { email: input.email } : {}), ...(input.refundAddress ? { refundAddress: input.refundAddress } : {}) } } : {}),
		}),
	);
	return inv ?? { error: { code: "NO_ADDRESS_AVAILABLE" } };
}

/**
 * A visitor's tip (spec change 33): taken whatever the wallet host's state, at the last sync's height (which never goes
 * down; with no sync ever there's no pool either). A fiat amount without a price becomes an open tip; any amount asks
 * for at least the floor. Settling is at the floor whatever was asked (`minAtomic`). Marked `via: "checkout"`, so the
 * admin's test tips stay apart.
 */
async function tipInvoice(ctx: PluginContext, input: TipInput, speed: Speed, siteCurrency: Currency, now: number): Promise<Invoice | { error: { code: CheckoutErrorCode } }> {
	let title: string | undefined;
	if (input.contentRef) {
		const entry = ctx.content ? await ctx.content.get(input.contentRef.collection, input.contentRef.id).catch(() => null) : null;
		if (!entry || entry.status !== "published") return { error: { code: "ENTRY_NOT_FOUND" } };
		if (typeof entry.data.title === "string" && entry.data.title.trim() !== "") title = entry.data.title.trim();
	}
	const chainHeight = (await ctx.kv.get<BridgeState>(KV.bridge))?.height ?? 0;

	let fiatMinor: bigint | null = null;
	let xmrAtomic: bigint | null = null;
	let rate: { minor: bigint; source: string } | null = null;
	let currency: Currency = siteCurrency;
	if (input.amount && "fiatMinor" in input.amount) {
		const r = await getRate(ctx, input.amount.currency, now);
		if (r) {
			fiatMinor = input.amount.fiatMinor;
			currency = input.amount.currency;
			rate = { minor: r.minor, source: r.source };
		}
	} else if (input.amount) {
		xmrAtomic = input.amount.xmrAtomic;
	}

	const inv = await claimAndStore(ctx, (row) => {
		const base = newInvoice({
			...newIds(),
			kind: "tip",
			fiatMinor,
			xmrAtomic,
			currency,
			rate,
			speed,
			subaddress: row.address,
			addrIndex: row.addrIndex,
			now,
			chainHeight,
			...(input.contentRef ? { contentRef: input.contentRef } : {}),
			uriDescription: (title ? `Tip: ${title}` : "Tip").slice(0, 100),
			...(input.note ? { buyer: { note: input.note } } : {}),
		});
		const floor = base.expectedAtomic !== null && BigInt(base.expectedAtomic) < DUST_ATOMIC ? { expectedAtomic: DUST_ATOMIC.toString() } : {};
		return { ...base, ...floor, via: "checkout" as const };
	});
	return inv ?? { error: { code: "NO_ADDRESS_AVAILABLE" } };
}
