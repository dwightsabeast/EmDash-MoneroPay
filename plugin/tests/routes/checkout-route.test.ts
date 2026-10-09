// checkout and status through the runtime host: products from content, prices from queued API responses, the pool,
// spam limits, and status reads. The price APIs are never called for real (http.respond).
import { afterEach, describe, expect, it } from "vitest";

import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";

import { MAX_OPEN_TOTAL, MAX_PER_CLIENT, checkoutHeight } from "../../src/checkout";
import { SILENT_MS } from "../../src/core/constants";
import { type Invoice, newInvoice } from "../../src/core/invoice";
import { PUBLIC_KEYS, bytesOf, signedHeaders } from "../sync/helpers";

let host: PluginRuntimeTestHost | undefined;
afterEach(async () => {
	await host?.dispose();
	host = undefined;
});

const KRAKEN = (pair: string) => `https://api.kraken.com/0/public/Ticker?pair=XMR${pair}`;
const GECKO = (c: string) => `https://api.coingecko.com/api/v3/simple/price?ids=monero&vs_currencies=${c}`;
const krakenBody = (pair: string, price: string) => JSON.stringify({ error: [], result: { [`XXMRZ${pair}`]: { c: [price, "1.0"] } } });
const ADDR = (i: number) => `7${String(i).padStart(94, "B")}`;
const H0 = 3_000_000;

async function setup(opts: { pool?: number; products?: boolean; lastSyncAgo?: number | null } = {}) {
	host = await createPluginRuntimeTestHost();
	// A wallet host that synced recently, unless a test says otherwise (null: never synced).
	const ago = opts.lastSyncAgo === undefined ? 30_000 : opts.lastSyncAgo;
	if (ago !== null) await host.fixtures.plugin.kv("state:bridge", { height: H0, lastSyncAt: Date.now() - ago, version: 1, outdated: false });
	if (opts.products !== false) {
		await host.fixtures.collection({ slug: "products", label: "Products", fields: [{ slug: "title", label: "Title", type: "string" }, { slug: "price", label: "Price", type: "number" }] } as never);
		for (const [slug, price, status] of [["handbook", 12, "published"], ["ebook", 19.99, "published"], ["draft-item", 5, "draft"], ["free", 0, "published"], ["odd", 19.999, "published"]] as const) {
			await host.fixtures.content("products", { slug, status, data: { title: `Test ${slug}`, price } } as never);
		}
	}
	for (let i = 1; i <= (opts.pool ?? 5); i++) await host.fixtures.plugin.storage("pool", String(i), { addrIndex: i, address: ADDR(i), status: "free" });
	return host;
}

async function checkout(body: unknown, ip: string | null = null) {
	const res = await (host as PluginRuntimeTestHost).actions.routes.request("checkout", {
		method: "POST", rawBody: JSON.stringify(body), headers: { "content-type": "application/json" },
		meta: { ip, userAgent: null, referer: null, geo: null },
	});
	return ((await res.json()) as any).data;
}
/**
 * Through `transport.invokeRoute`, which passes `meta.ip` straight to the plugin, like a Cloudflare Workers site.
 * `actions.routes.request` derives requestMeta the real way, so off Cloudflare its ip is always null (spike Q5).
 */
async function checkoutWithIp(body: unknown, ip: string) {
	return (host as any).transport.invokeRoute("checkout", body, { method: "POST", meta: { ip, userAgent: null, referer: null, geo: null } });
}
async function status(token: string) {
	const res = await (host as PluginRuntimeTestHost).actions.routes.request("status", { method: "GET", url: `https://site.test/_emdash/api/plugins/coffer/status?token=${encodeURIComponent(token)}` });
	return { cacheControl: res.headers.get("cache-control"), data: ((await res.json()) as any).data };
}

describe("checkout", () => {
	it("creates an invoice from the product's price and the Kraken rate, on a pool address", async ({ task }) => {
		const h = await setup();
		await h.http.respond(KRAKEN("USD"), new Response(krakenBody("USD", "150.00000000")));
		const r = await checkout({ kind: "product", product: "handbook", email: "a@example.invalid" });
		Object.assign(task.meta, { r });
		expect(r).toMatchObject({ address: ADDR(1), amountAtomic: "80000000000", amountXmr: "0.080000000000", status: "new" });
		expect(r.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
		expect(r.uri).toBe(`monero:${ADDR(1)}?tx_amount=0.080000000000&tx_description=Test%20handbook`);
		const stored = (await h.inspect.storage.list<Invoice>("invoices"))[0].data;
		expect(stored).toMatchObject({ kind: "product", required: 2, fiat: { amountMinor: "1200", currency: "USD" }, rate: { minor: "15000", source: "api.kraken.com" }, buyer: { email: "a@example.invalid" } });
		expect(await h.inspect.storage.get("pool", "1")).toMatchObject({ status: "claimed", invoiceId: stored.id });
		expect(h.http.requests().map((q) => q.url)).toEqual([KRAKEN("USD")]);
	});

	it("finds products by slug or id, and ignores a client-sent price", async () => {
		const h = await setup();
		await h.http.respond(KRAKEN("USD"), new Response(krakenBody("USD", "150")));
		const bySlug = await checkout({ kind: "product", product: "ebook", amount: "0.000001", price: 0.01 });
		expect(bySlug.amountAtomic).toBe("133266666667"); // ceil(1999e12 / 15000): the entry's $19.99, not the client's numbers
		const ebook = (await h.inspect.content.list("products")).find((c: any) => c.slug === "ebook");
		const byId = await checkout({ kind: "product", product: (ebook as any).id });
		expect(byId.amountAtomic).toBe("133266666667"); // cached rate, no new request
		expect(h.http.requests()).toHaveLength(1);
	});

	it("PRODUCT_NOT_FOUND for unknown, draft, zero-priced, or over-precise products", async () => {
		await setup();
		for (const product of ["nope", "draft-item", "free", "odd"]) expect(await checkout({ kind: "product", product })).toEqual({ error: { code: "PRODUCT_NOT_FOUND" } });
	});

	it("falls back to CoinGecko, and RATE_UNAVAILABLE when both fail (nothing claimed)", async () => {
		const h = await setup();
		await h.http.respond(KRAKEN("USD"), new Response("oops", { status: 502 }));
		await h.http.respond(GECKO("usd"), new Response('{"monero":{"usd":150.0}}'));
		const ok = await checkout({ kind: "product", product: "handbook" });
		expect(ok.amountAtomic).toBe("80000000000");
		expect((await h.inspect.storage.list<Invoice>("invoices"))[0].data.rate?.source).toBe("api.coingecko.com");
	});

	it("RATE_UNAVAILABLE when neither source answers sensibly", async () => {
		const h = await setup();
		await h.http.respond(KRAKEN("USD"), new Response(JSON.stringify({ error: ["EGeneral:Temporary lockout"], result: {} })));
		await h.http.respond(GECKO("usd"), new Response('{"monero":{"usd":0}}'));
		expect(await checkout({ kind: "product", product: "handbook" })).toEqual({ error: { code: "RATE_UNAVAILABLE" } });
		expect(await h.inspect.storage.list("invoices")).toEqual([]);
		expect(await h.inspect.storage.get("pool", "1")).toMatchObject({ status: "free" });
	});

	it("uses the currency setting (EUR)", async () => {
		const h = await setup();
		await h.fixtures.plugin.setting("currency", "EUR");
		await h.http.respond(KRAKEN("EUR"), new Response(krakenBody("EUR", "120.00")));
		const r = await checkout({ kind: "product", product: "handbook" });
		expect(r.amountAtomic).toBe("100000000000"); // 12.00 EUR at 120.00 EUR
		expect(h.http.requests().map((q) => q.url)).toEqual([KRAKEN("EUR")]);
	});

	it("NO_ADDRESS_AVAILABLE when the pool is empty", async () => {
		const h = await setup({ pool: 0 });
		await h.http.respond(KRAKEN("USD"), new Response(krakenBody("USD", "150")));
		expect(await checkout({ kind: "product", product: "handbook" })).toEqual({ error: { code: "NO_ADDRESS_AVAILABLE" } });
	});

	it("WALLET_HOST_SILENT when the bridge never synced or last synced over 5 minutes ago: no price request, nothing claimed (spec change 16)", async () => {
		for (const lastSyncAgo of [null, 6 * 60_000]) {
			const h = await setup({ lastSyncAgo });
			expect(await checkout({ kind: "product", product: "handbook" })).toEqual({ error: { code: "WALLET_HOST_SILENT" } });
			expect(h.http.requests()).toEqual([]);
			expect(await h.inspect.storage.list("invoices")).toEqual([]);
			expect(await h.inspect.storage.get("pool", "1")).toMatchObject({ status: "free" });
			await h.dispose();
			host = undefined;
		}
	});

	it("the invoice's createdHeight is the last sync's height, never an estimate", async () => {
		const h = await setup({ lastSyncAgo: 4 * 60_000 });
		await h.http.respond(KRAKEN("USD"), new Response(krakenBody("USD", "150")));
		await checkout({ kind: "product", product: "handbook" });
		expect((await h.inspect.storage.list<Invoice>("invoices"))[0].data).toMatchObject({ createdHeight: H0, expiresHeight: H0 + 18 });
	});

	it("INVALID_REQUEST for anything but a well-formed product checkout", async () => {
		await setup();
		for (const body of [null, [], {}, { kind: "tip" }, { kind: "order", product: "handbook" }, { kind: "product" }, { kind: "product", product: "a/b" },
			{ kind: "product", product: "handbook", email: "not-an-email" }, { kind: "product", product: "handbook", refundAddress: "4abc" }]) {
			expect(await checkout(body)).toEqual({ error: { code: "INVALID_REQUEST" } });
		}
	});

	it("site-wide cap: TOO_MANY_OPEN at the cap; invoices past their deadline stop counting", async () => {
		const h = await setup();
		const now = Date.now();
		for (let i = 0; i < MAX_OPEN_TOTAL; i++) {
			const inv = newInvoice({ id: `inv_open${i}`, token: `t${String(i).padStart(21, "0")}`, kind: "product", fiatMinor: 100n, currency: "USD", rate: { minor: 15000n, source: "t" }, speed: "standard", subaddress: ADDR(100 + i), addrIndex: 100 + i, now, chainHeight: H0 });
			await h.fixtures.plugin.storage("invoices", inv.id, inv);
		}
		expect(await checkout({ kind: "product", product: "handbook" })).toEqual({ error: { code: "TOO_MANY_OPEN" } });
		// A bridge outage keeps them "new", but past expiresAt they no longer count, so checkout isn't locked.
		for (let i = 0; i < MAX_OPEN_TOTAL; i++) {
			const inv = (await h.inspect.storage.get<Invoice>("invoices", `inv_open${i}`)) as Invoice;
			await h.fixtures.plugin.storage("invoices", inv.id, { ...inv, expiresAt: now - 1 });
		}
		await h.http.respond(KRAKEN("USD"), new Response(krakenBody("USD", "150")));
		expect((await checkout({ kind: "product", product: "handbook" })).status).toBe("new");
	});

	it("records whether the last checkout came with the visitor's IP (the admin page's spam-limit line)", async () => {
		const h = await setup();
		await h.http.respond(KRAKEN("USD"), new Response(krakenBody("USD", "150")));
		expect(await h.inspect.kv.get("state:clientIp")).toBeNull();
		await checkout({ kind: "product", product: "handbook" });
		expect(await h.inspect.kv.get("state:clientIp")).toBe(false);
		await checkoutWithIp({ kind: "product", product: "handbook" }, "203.0.113.7");
		expect(await h.inspect.kv.get("state:clientIp")).toBe(true);
	});

	it("per-client cap only when the IP is known", async ({ task }) => {
		const h = await setup({ pool: 8 });
		await h.http.respond(KRAKEN("USD"), new Response(krakenBody("USD", "150")));
		const results: unknown[] = [];
		for (let i = 0; i < MAX_PER_CLIENT; i++) results.push(await checkoutWithIp({ kind: "product", product: "handbook" }, "203.0.113.5"));
		results.push(await checkoutWithIp({ kind: "product", product: "handbook" }, "203.0.113.5"));
		results.push(await checkoutWithIp({ kind: "product", product: "handbook" }, "203.0.113.6"));
		Object.assign(task.meta, { results });
		const statusOf = (r: any) => r?.data?.status ?? r?.status ?? r?.data?.error?.code ?? r?.error?.code;
		expect(results.slice(0, MAX_PER_CLIENT).map(statusOf)).toEqual(Array(MAX_PER_CLIENT).fill("new"));
		expect(statusOf(results[MAX_PER_CLIENT])).toBe("TOO_MANY_OPEN");
		expect(statusOf(results[MAX_PER_CLIENT + 1])).toBe("new");
		// Through the real request path the IP is unknown (no Cloudflare cf object), so only the site-wide cap applies.
		expect((await checkout({ kind: "product", product: "handbook" })).status).toBe("new");
		const buckets = (await h.inspect.kv.get<Record<string, number[]>>("state:buckets")) ?? {};
		expect(Object.keys(buckets)).toHaveLength(2);
		expect(JSON.stringify(buckets)).not.toContain("203.0.113"); // hashed, never raw IPs
	});
});

describe("checkoutHeight", () => {
	const bridge = { height: H0, lastSyncAt: 1_790_000_000_000, version: 1, outdated: false };
	it("the stored height while the last sync is at most 5 minutes old, null after that or without a sync", () => {
		expect(SILENT_MS).toBe(5 * 60_000);
		expect(checkoutHeight(bridge, bridge.lastSyncAt)).toBe(H0);
		expect(checkoutHeight(bridge, bridge.lastSyncAt + SILENT_MS)).toBe(H0);
		expect(checkoutHeight(bridge, bridge.lastSyncAt + SILENT_MS + 1)).toBeNull();
		expect(checkoutHeight(null, bridge.lastSyncAt)).toBeNull();
	});
});

describe("status", () => {
	it("returns the invoice's state by token, private and uncached; INVOICE_NOT_FOUND otherwise", async () => {
		const h = await setup();
		await h.http.respond(KRAKEN("USD"), new Response(krakenBody("USD", "150")));
		const c = await checkout({ kind: "product", product: "handbook" });
		const s = await status(c.token);
		expect(s.cacheControl).toContain("no-store");
		expect(s.data).toEqual({
			status: "new", confirmations: 0, required: 2, amountAtomic: "80000000000", receivedAtomic: "0",
			expiresAt: c.expiresAt, settledAt: null, pendingExpiry: false, reconfirming: false,
		});
		expect((await status("A".repeat(22))).data).toEqual({ error: { code: "INVOICE_NOT_FOUND" } });
		expect((await status("short")).data).toEqual({ error: { code: "INVOICE_NOT_FOUND" } });
	});

	it("shows pendingExpiry after the window without a sync, and doesn't write", async () => {
		const h = await setup();
		const now = Date.now();
		const inv = { ...newInvoice({ id: "inv_late", token: "L".repeat(22), kind: "product", fiatMinor: 1200n, currency: "USD", rate: { minor: 15000n, source: "t" }, speed: "standard", subaddress: ADDR(9), addrIndex: 9, now: now - 3_600_000, chainHeight: H0 }) };
		await h.fixtures.plugin.storage("invoices", inv.id, inv);
		expect((await status(inv.token)).data).toMatchObject({ status: "new", pendingExpiry: true });
		expect(await h.inspect.storage.get("invoices", inv.id)).toEqual(inv);
	});

	it("checkout, a signed sync with the payment, then status reads settled", async () => {
		const h = await setup();
		await h.fixtures.plugin.setting("bridgePublicKey", PUBLIC_KEYS.test1);
		await h.http.respond(KRAKEN("USD"), new Response(krakenBody("USD", "150")));
		const c = await checkout({ kind: "product", product: "handbook" });
		const now = Date.now();
		const bytes = bytesOf({ v: 1, seq: now, height: H0 + 2, addresses: [], snapshots: [{ index: 1, transfers: [{ txid: "cd".repeat(32), amount: c.amountAtomic, confirmations: 2, height: H0 + 1, timestamp: Math.floor(now / 1000), doubleSpendSeen: false, unlockTime: "0" }] }] });
		const sync = await h.actions.routes.request("bridge/sync", { method: "POST", rawBody: bytes, headers: await signedHeaders(bytes, now) });
		expect(((await sync.json()) as any).data).toMatchObject({ ok: true, watch: [1] });
		expect((await status(c.token)).data).toMatchObject({ status: "settled", confirmations: 2, required: 2, receivedAtomic: "80000000000" });
	});
});
