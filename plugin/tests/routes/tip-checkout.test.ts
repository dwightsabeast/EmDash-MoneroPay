// Tip checkout (phase 07; spec changes 22 and 33): open, fiat and XMR amounts, an optional entry and note, taken while
// the wallet host is silent or syncing, open when no price is available, and kept apart from the admin's test tips.
import { afterEach, describe, expect, it } from "vitest";

import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";

import { MAX_OPEN_TOTAL } from "../../src/checkout";
import { type Invoice, newInvoice } from "../../src/core/invoice";
import { PUBLIC_KEYS } from "../sync/helpers";

let host: PluginRuntimeTestHost | undefined;
afterEach(async () => {
	await host?.dispose();
	host = undefined;
});

type B = Record<string, any>;
const H0 = 3_000_000;
const ADDR = (i: number) => `7${String(i).padStart(94, "T")}`;
const KRAKEN = (pair: string) => `https://api.kraken.com/0/public/Ticker?pair=XMR${pair}`;
const GECKO = (c: string) => `https://api.coingecko.com/api/v3/simple/price?ids=monero&vs_currencies=${c}`;
const kraken = (pair: string, price: string) => new Response(JSON.stringify({ error: [], result: { [`XXMRZ${pair}`]: { c: [price, "1.0"] } } }));

async function setup(o: { lastSyncAgo?: number | null; checks?: unknown; pool?: number; speed?: string } = {}) {
	const h = await createPluginRuntimeTestHost();
	host = h;
	await h.fixtures.plugin.setting("bridgePublicKey", PUBLIC_KEYS.test1);
	if (o.speed) await h.fixtures.plugin.setting("speed", o.speed);
	const ago = o.lastSyncAgo === undefined ? 30_000 : o.lastSyncAgo;
	if (ago !== null) await h.fixtures.plugin.kv("state:bridge", { height: H0, lastSyncAt: Date.now() - ago, version: 1, outdated: false, ...(o.checks ? { checks: o.checks } : {}) });
	await h.fixtures.collection({ slug: "posts", label: "Posts", fields: [{ slug: "title", label: "Title", type: "string" }] } as never);
	await h.fixtures.content("posts", { slug: "hello", status: "published", data: { title: "Hello & welcome" } } as never);
	await h.fixtures.content("posts", { slug: "unfinished", status: "draft", data: { title: "Draft" } } as never);
	for (let i = 1; i <= (o.pool ?? 5); i++) await h.fixtures.plugin.storage("pool", String(i), { addrIndex: i, address: ADDR(i), status: "free" });
	return h;
}

async function tip(body: Record<string, unknown> = {}) {
	const res = await (host as PluginRuntimeTestHost).actions.routes.request("checkout", { method: "POST", rawBody: JSON.stringify({ kind: "tip", ...body }), headers: { "content-type": "application/json" } });
	return ((await res.json()) as B).data;
}
const stored = async () => (await (host as PluginRuntimeTestHost).inspect.storage.list<Invoice>("invoices")).map((i) => i.data);
const entryId = async (slug: string) => ((await (host as PluginRuntimeTestHost).inspect.content.list("posts")) as B[]).find((e) => e.slug === slug)?.id as string;

describe("tip checkout", () => {
	it("an open tip: no amount in the link, the floor as the minimum, the lowest confirmation tier, marked as a visitor's tip", async () => {
		const h = await setup({ speed: "strict" });
		const r = await tip();
		expect(r).toMatchObject({ address: ADDR(1), amountAtomic: null, amountXmr: null, status: "new", uri: `monero:${ADDR(1)}?tx_description=Tip` });
		const [inv] = await stored();
		expect(inv).toMatchObject({ kind: "tip", expectedAtomic: null, minAtomic: "100000000", fiat: null, rate: null, required: 10, via: "checkout", uriDescription: "Tip", createdHeight: H0 });
		expect(inv.buyer).toBeUndefined();
		expect(h.http.requests()).toEqual([]); // no price needed
	});

	it("a fiat amount: converted at the locked rate (ceiling), the fiat kept, the floor still the threshold", async () => {
		const h = await setup();
		await h.http.respond(KRAKEN("USD"), kraken("USD", "150.00"));
		const r = await tip({ amount: { fiatMinor: "500", currency: "USD" } });
		// 500 cents at 15000 cents/XMR: ceil(500 * 10^12 / 15000) = 33333333334.
		expect(r).toMatchObject({ amountAtomic: "33333333334", amountXmr: "0.033333333334", uri: `monero:${ADDR(1)}?tx_amount=0.033333333334&tx_description=Tip` });
		expect((await stored())[0]).toMatchObject({ expectedAtomic: "33333333334", minAtomic: "100000000", fiat: { amountMinor: "500", currency: "USD" }, rate: { minor: "15000", source: "api.kraken.com" } });
	});

	it("a fiat amount in EUR uses the EUR rate, whatever the site's currency", async () => {
		const h = await setup();
		await h.http.respond(KRAKEN("EUR"), kraken("EUR", "100.00"));
		await tip({ amount: { fiatMinor: "300", currency: "EUR" } });
		expect((await stored())[0]).toMatchObject({ expectedAtomic: "30000000000", fiat: { amountMinor: "300", currency: "EUR" } });
		expect(h.http.requests().map((q) => q.url)).toEqual([KRAKEN("EUR")]);
	});

	it("no price from either service: the fiat tip becomes an open tip instead of failing (Wyatt)", async () => {
		const h = await setup();
		for (const url of [KRAKEN("USD"), GECKO("usd")]) await h.http.respond(url, new Response("down", { status: 502 }));
		const r = await tip({ amount: { fiatMinor: "500", currency: "USD" } });
		expect(r).toMatchObject({ amountAtomic: null, status: "new" });
		expect((await stored())[0]).toMatchObject({ expectedAtomic: null, fiat: null, rate: null, minAtomic: "100000000" });
	});

	it("a tiny fiat amount still asks for at least the floor", async () => {
		const h = await setup();
		await h.http.respond(KRAKEN("USD"), kraken("USD", "150.00"));
		await tip({ amount: { fiatMinor: "1", currency: "USD" } }); // 1 cent = 0.0000667 XMR, under the floor
		expect((await stored())[0]).toMatchObject({ expectedAtomic: "100000000", fiat: { amountMinor: "1", currency: "USD" } });
	});

	it("an XMR amount: as given, no price request", async () => {
		const h = await setup();
		const r = await tip({ amount: { xmrAtomic: "250000000000" } });
		expect(r).toMatchObject({ amountAtomic: "250000000000", uri: `monero:${ADDR(1)}?tx_amount=0.250000000000&tx_description=Tip` });
		expect((await stored())[0]).toMatchObject({ expectedAtomic: "250000000000", fiat: null, rate: null });
		expect(h.http.requests()).toEqual([]);
	});

	it("an entry: checked to exist and be published; its title in the payment link", async () => {
		await setup();
		const id = await entryId("hello");
		const r = await tip({ contentRef: { collection: "posts", id } });
		expect(r.uri).toBe(`monero:${ADDR(1)}?tx_description=Tip%3A%20Hello%20%26%20welcome`);
		expect((await stored())[0]).toMatchObject({ contentRef: { collection: "posts", id }, uriDescription: "Tip: Hello & welcome" });
		expect(await tip({ contentRef: { collection: "posts", id: "nope" } })).toEqual({ error: { code: "ENTRY_NOT_FOUND" } });
		expect(await tip({ contentRef: { collection: "posts", id: await entryId("unfinished") } })).toEqual({ error: { code: "ENTRY_NOT_FOUND" } });
		expect(await tip({ contentRef: { collection: "nothing_here", id } })).toEqual({ error: { code: "ENTRY_NOT_FOUND" } });
		expect(await stored()).toHaveLength(1);
	});

	it("a note: control and format characters out, whitespace collapsed, at most 140 characters, kept as buyer data", async () => {
		await setup();
		await tip({ note: "  Thanks\n\tfor\u0000 the‮ post​! <b>hi</b> [x](https://e.test)  " });
		expect((await stored())[0].buyer).toEqual({ note: "Thanks for the post! <b>hi</b> [x](https://e.test)" });
		await tip({ note: "🧡".repeat(140) });
		expect((await stored()).find((i) => i.buyer?.note?.startsWith("🧡"))?.buyer?.note).toBe("🧡".repeat(140));
		expect(await tip({ note: "a".repeat(141) })).toEqual({ error: { code: "INVALID_REQUEST" } });
		await tip({ note: " \n​ " });
		expect((await stored()).filter((i) => i.buyer === undefined)).toHaveLength(1); // nothing left: no note
	});

	it("INVALID_REQUEST for a malformed amount, entry or note; nothing claimed", async () => {
		await setup();
		const bad: Array<Record<string, unknown>> = [
			{ amount: { fiatMinor: "500" } },
			{ amount: { fiatMinor: "500", currency: "GBP" } },
			{ amount: { fiatMinor: 500, currency: "USD" } },
			{ amount: { fiatMinor: "0", currency: "USD" } },
			{ amount: { fiatMinor: "-5", currency: "USD" } },
			{ amount: { fiatMinor: "1000001", currency: "USD" } },
			{ amount: { xmrAtomic: "99999999" } },
			{ amount: { xmrAtomic: "1.5" } },
			{ amount: { xmrAtomic: "1000000000000001" } },
			{ amount: { xmrAtomic: "200000000", fiatMinor: "500", currency: "USD" } },
			{ amount: "5" },
			{ contentRef: { collection: "posts" } },
			{ contentRef: { collection: "Posts!", id: "x" } },
			{ contentRef: { collection: "posts", id: "a/b" } },
			{ note: 5 },
		];
		for (const b of bad) expect(await tip(b), JSON.stringify(b)).toEqual({ error: { code: "INVALID_REQUEST" } });
		expect(await stored()).toEqual([]);
	});

	it("unknown fields are ignored, never trusted: no price, email or refund address from the client", async () => {
		await setup();
		await tip({ price: 0.0001, amountAtomic: "1", email: "a@example.invalid", refundAddress: ADDR(9) });
		expect((await stored())[0]).toMatchObject({ expectedAtomic: null });
		expect((await stored())[0].buyer).toBeUndefined();
	});

	it("taken while the wallet host is silent or its node syncs, at the last sync's height; never synced means no address", async () => {
		await setup({ lastSyncAgo: 12 * 60_000 });
		expect(await tip()).toMatchObject({ status: "new" });
		expect((await stored())[0].createdHeight).toBe(H0);
		await host?.dispose();
		await setup({ checks: { wallet: { state: "syncing", detail: "behind" } } });
		expect(await tip()).toMatchObject({ status: "new" });
		await host?.dispose();
		await setup({ lastSyncAgo: null, pool: 0 });
		expect(await tip()).toEqual({ error: { code: "NO_ADDRESS_AVAILABLE" } });
	});

	it("the same spam cap as products", async () => {
		const h = await setup();
		const now = Date.now();
		for (let i = 0; i < MAX_OPEN_TOTAL; i++) {
			const inv = newInvoice({ id: `inv_cap${i}`, token: `c${String(i).padStart(21, "0")}`, kind: "tip", fiatMinor: null, currency: "USD", rate: null, speed: "standard", subaddress: ADDR(100 + i), addrIndex: 100 + i, now, chainHeight: H0 });
			await h.fixtures.plugin.storage("invoices", inv.id, inv);
		}
		expect(await tip()).toEqual({ error: { code: "TOO_MANY_OPEN" } });
	});

	it("a visitor's tip isn't the admin's test tip: it doesn't complete setup or stand in for the test address", async () => {
		const h = await setup();
		await h.http.respond(KRAKEN("USD"), kraken("USD", "150.00")); // the checklist's price line, so it's ready
		await tip();
		const [visitor] = await stored();
		await h.fixtures.plugin.storage("invoices", visitor.id, { ...visitor, status: "settled", settledAt: Date.now() });
		let blocks = (await h.admin.loadPage("/payments")).blocks as B[];
		expect(JSON.stringify(blocks)).not.toContain("Setup (complete)");
		const r = await h.admin.act("/payments", "get_test_address");
		expect(r.toast).toMatchObject({ type: "success" });
		const test = (await stored()).find((i) => i.id !== visitor.id);
		expect(test).toMatchObject({ kind: "tip", required: 1, uriDescription: "Coffer test tip" });
		expect(test?.via).toBeUndefined();
		blocks = r.blocks as B[];
		expect(JSON.stringify(blocks)).toContain(test?.subaddress);
		expect(JSON.stringify(blocks)).not.toContain(visitor.subaddress);
	});
});
