// The release-1 switch (spec change 22, GOODS_ENABLED): with it off, checkout answers product and order checkouts
// exactly as it answers an unknown kind, and the admin page leaves out All invoices. This file runs under both configs:
// vitest.config.ts (the switch as committed) and vitest.goods.config.ts (a copy built with it on).
import { afterEach, describe, expect, it } from "vitest";

import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";

import { GOODS_ENABLED } from "../../src/core/constants";
import { PUBLIC_KEYS } from "../sync/helpers";

let host: PluginRuntimeTestHost | undefined;
afterEach(async () => {
	await host?.dispose();
	host = undefined;
});

type B = Record<string, any>;
const H0 = 3_000_000;

async function setup() {
	const h = await createPluginRuntimeTestHost();
	host = h;
	await h.fixtures.plugin.setting("bridgePublicKey", PUBLIC_KEYS.test1);
	await h.fixtures.plugin.kv("state:bridge", { height: H0, lastSyncAt: Date.now() - 30_000, version: 1, outdated: false });
	await h.fixtures.plugin.kv("state:setupDone", true);
	await h.fixtures.collection({ slug: "products", label: "Products", fields: [{ slug: "title", label: "Title", type: "string" }, { slug: "price", label: "Price", type: "number" }] } as never);
	await h.fixtures.content("products", { slug: "handbook", status: "published", data: { title: "Handbook", price: 12 } } as never);
	for (let i = 1; i <= 3; i++) await h.fixtures.plugin.storage("pool", String(i), { addrIndex: i, address: `7${String(i).padStart(94, "R")}`, status: "free" });
	await h.http.respond("https://api.kraken.com/0/public/Ticker?pair=XMRUSD", new Response(JSON.stringify({ error: [], result: { XXMRZUSD: { c: ["150.00", "1.0"] } } })));
	return h;
}

async function checkout(body: unknown) {
	const res = await (host as PluginRuntimeTestHost).actions.routes.request("checkout", { method: "POST", rawBody: JSON.stringify(body), headers: { "content-type": "application/json" } });
	return { status: res.status, text: await res.text() };
}

describe("release-1 switch", () => {
	it("the committed value is off for release 1, and this run was built with the value the test expects", () => {
		expect(GOODS_ENABLED).toBe(false);
		expect(typeof __COFFER_GOODS__).toBe("boolean");
	});

	it.runIf(!__COFFER_GOODS__)("off: product and order checkouts get exactly the unknown kind's reply, and nothing is claimed", async () => {
		const h = await setup();
		const unknown = await checkout({ kind: "nonsense", product: "handbook" });
		expect(JSON.parse(unknown.text).data).toEqual({ error: { code: "INVALID_REQUEST" } });
		expect(await checkout({ kind: "product", product: "handbook" })).toEqual(unknown);
		expect(await checkout({ kind: "order", orderRef: "o1", amountMinor: 1200, currency: "USD", returnUrl: "https://site.test/o/1" })).toEqual(unknown);
		expect((await h.inspect.storage.list("invoices")).length).toBe(0);
		expect(h.http.requests()).toEqual([]);
	});

	it.runIf(__COFFER_GOODS__)("on: product checkout works again", async () => {
		await setup();
		const r = await checkout({ kind: "product", product: "handbook" });
		expect(JSON.parse(r.text).data).toMatchObject({ status: "new", amountAtomic: "80000000000" });
	});

	it("the admin page has All invoices only with the switch on", async () => {
		const h = await setup();
		const blocks = (await h.admin.loadPage("/payments")).blocks as B[];
		expect(blocks.some((b) => b.type === "header" && b.text === "All invoices")).toBe(__COFFER_GOODS__);
	});
});
