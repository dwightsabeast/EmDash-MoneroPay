// The watch list on Node with more than 1,000 recent invoices (spec change 35, condition 2): every one that's watched is
// on the list (the scan used to stop silently at 1,000), tips stay watched for their 7 days, and Health warns if the
// scan's safety cap is ever reached.
import { afterEach, describe, expect, it } from "vitest";

import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";

import { type Invoice, newInvoice } from "../../src/core/invoice";
import { PUBLIC_KEYS, bytesOf, signedHeaders } from "../sync/helpers";

let host: PluginRuntimeTestHost | undefined;
afterEach(async () => {
	await host?.dispose();
	host = undefined;
});

type B = Record<string, any>;
const H0 = 3_000_000;
const DAY = 86_400_000;

function tip(i: number, createdAgo: number, over: Partial<Invoice> = {}): Invoice {
	const created = Date.now() - createdAgo;
	const inv = newInvoice({ id: `inv_w${i}`, token: `w${String(i).padStart(21, "0")}`, kind: "tip", fiatMinor: null, currency: "USD", rate: null, speed: "standard", subaddress: `7${String(i).padStart(94, "W")}`, addrIndex: i, now: created, chainHeight: H0 });
	return { ...inv, status: "expired", seq: created + 31 * 60_000, finalAt: created + 31 * 60_000, via: "checkout", ...over };
}

async function sync(h: PluginRuntimeTestHost) {
	const now = Date.now();
	const bytes = bytesOf({ v: 1, seq: now, height: H0 + 500, addresses: [], snapshots: [] });
	const res = await h.actions.routes.request("bridge/sync", { method: "POST", rawBody: bytes, headers: await signedHeaders(bytes, now) });
	return ((await res.json()) as B).data;
}

describe("watch list scan", () => {
	it("1,200 recent tips are all watched, and a touched 5-day-old tip too", { timeout: 120_000 }, async () => {
		const h = await createPluginRuntimeTestHost();
		host = h;
		await h.fixtures.plugin.setting("bridgePublicKey", PUBLIC_KEYS.test1);
		await h.fixtures.plugin.kv("state:bridge", { height: H0, lastSyncAt: Date.now() - 30_000, version: 1, outdated: false });
		const all = Array.from({ length: 1_200 }, (_, i) => tip(i + 1, (i % 20) * 60 * 60_000 + 60 * 60_000));
		const touched = tip(5_000, 5 * DAY, { transfers: [{ txid: "ab".repeat(32), amountAtomic: "50", confirmations: 3, height: H0 + 1, timestamp: 1_790_000_000, doubleSpendSeen: false, unlockTime: "0", seenAt: 1, poolTs: null }] });
		const untouchedOld = tip(6_000, 5 * DAY); // reported empty for days: not watched
		for (let i = 0; i < all.length; i += 100) await Promise.all(all.slice(i, i + 100).map((inv) => h.fixtures.plugin.storage("invoices", inv.id, inv)));
		await h.fixtures.plugin.storage("invoices", touched.id, touched);
		await h.fixtures.plugin.storage("invoices", untouchedOld.id, { ...untouchedOld, seq: Date.now() - 60_000 });
		const r = await sync(h);
		expect(r.ok).toBe(true);
		expect(r.watch).toHaveLength(1_201);
		expect(r.watch).toContain(5_000);
		expect(r.watch).not.toContain(6_000);
		expect(await h.inspect.kv.get("state:watchTruncatedAt")).toBeNull();
	});

	it("Health warns for a day after the scan's safety cap was reached", async () => {
		const h = await createPluginRuntimeTestHost();
		host = h;
		await h.fixtures.plugin.setting("bridgePublicKey", PUBLIC_KEYS.test1);
		await h.fixtures.plugin.kv("state:bridge", { height: H0, lastSyncAt: Date.now() - 30_000, version: 1, outdated: false });
		await h.fixtures.plugin.kv("state:setupDone", true);
		await h.http.respond("https://api.kraken.com/0/public/Ticker?pair=XMRUSD", new Response(JSON.stringify({ error: [], result: { XXMRZUSD: { c: ["150.00", "1.0"] } } })));
		const title = "The watch list hit its safety cap";
		await h.fixtures.plugin.kv("state:watchTruncatedAt", Date.now() - 60 * 60_000);
		expect(JSON.stringify((await h.admin.loadPage("/payments")).blocks)).toContain(title);
		await h.fixtures.plugin.kv("state:watchTruncatedAt", Date.now() - 25 * 60 * 60_000);
		expect(JSON.stringify((await h.admin.loadPage("/payments")).blocks)).not.toContain(title);
	});
});
