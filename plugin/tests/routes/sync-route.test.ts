// bridge/sync through the runtime host: the declared route, ctx-backed storage, alerts, housekeeping, the backup cron,
// restart, and pairing end to end. Signed with the RFC 8032 test keys (tests/sync/helpers.ts).
import { afterEach, describe, expect, it } from "vitest";

import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";

import { type Invoice, newInvoice } from "../../src/core/invoice";
import { PURGE_MS } from "../../src/housekeeping";
import { newPairingCode } from "../../src/sync/pairing";
import { PUBLIC_KEYS, bytesOf, signedHeaders } from "../sync/helpers";

let host: PluginRuntimeTestHost | undefined;
afterEach(async () => {
	await host?.dispose();
	host = undefined;
});

const H0 = 3_000_000;
const ADDR = (i: number) => `7${String(i).padStart(94, "A")}`;
const TXID = (n: number) => n.toString(16).padStart(64, "0");

async function sync(body: Record<string, unknown>, key: "test1" | "test2" = "test1") {
	const now = Date.now();
	const bytes = bytesOf({ v: 1, seq: now, height: H0, addresses: [], snapshots: [], ...body });
	const res = await (host as PluginRuntimeTestHost).actions.routes.request("bridge/sync", {
		method: "POST", rawBody: bytes, headers: { ...(await signedHeaders(bytes, now, key)), "content-type": "application/octet-stream" },
	});
	return { status: res.status, json: (await res.json()) as any };
}

async function paired() {
	host = await createPluginRuntimeTestHost();
	await host.fixtures.plugin.setting("bridgePublicKey", PUBLIC_KEYS.test1);
	return host;
}

async function claimedInvoice(h: PluginRuntimeTestHost, index: number, over: Partial<Invoice> = {}) {
	const inv = { ...newInvoice({ id: `inv_${index}`, token: `tok${index}`, kind: "product", fiatMinor: 1200n, currency: "USD", rate: { minor: 15000n, source: "t" }, speed: "standard", subaddress: ADDR(index), addrIndex: index, now: Date.now(), chainHeight: H0 }), ...over };
	await h.fixtures.plugin.storage("pool", String(index), { addrIndex: index, address: ADDR(index), status: "claimed", invoiceId: inv.id });
	await h.fixtures.plugin.storage("invoices", inv.id, inv);
	return inv;
}

describe("bridge/sync route", () => {
	it("NOT_PAIRED until a key is stored", async () => {
		host = await createPluginRuntimeTestHost();
		const r = await sync({});
		expect(r.json).toMatchObject({ success: true, data: { error: { code: "NOT_PAIRED" } } });
	});

	it("tops up the pool in storage and reports it", async ({ task }) => {
		const h = await paired();
		const r = await sync({ addresses: [1, 2, 3].map((i) => ({ index: i, address: ADDR(i) })) });
		Object.assign(task.meta, { r });
		expect(r.json).toMatchObject({ success: true, data: { ok: true, poolFree: 3, poolTarget: 50, watch: [] } });
		const rows = await h.inspect.storage.list<{ status: string }>("pool");
		expect(rows.map((x) => x.id).sort()).toEqual(["1", "2", "3"]);
		expect(rows.every((x) => x.data.status === "free")).toBe(true);
		expect(await h.inspect.kv.get("state:bridge")).toMatchObject({ height: H0, version: 1, outdated: false });
	});

	it("reports poolTop from storage: numeric order, claimed rows included", async () => {
		const h = await paired();
		expect((await sync({})).json).toMatchObject({ data: { ok: true, poolTop: 0 } });
		await claimedInvoice(h, 100);
		const r = await sync({ addresses: [9, 12].map((i) => ({ index: i, address: ADDR(i) })) });
		expect(r.json).toMatchObject({ data: { ok: true, poolFree: 2, poolTop: 100 } }); // "9" > "100" as text
	});

	it("never resets a claimed pool row when the bridge re-sends its address", async () => {
		const h = await paired();
		await claimedInvoice(h, 4);
		await sync({ addresses: [{ index: 4, address: ADDR(4) }] });
		expect(await h.inspect.storage.get("pool", "4")).toMatchObject({ status: "claimed", invoiceId: "inv_4" });
	});

	it("settles an invoice from signed snapshots, records an alert on reversal, and survives a restart", async () => {
		const h = await paired();
		const inv = await claimedInvoice(h, 7);
		const transfer = (confirmations: number, height: number) => ({ txid: TXID(1), amount: inv.expectedAtomic, confirmations, height, timestamp: Math.floor(Date.now() / 1000), doubleSpendSeen: false, unlockTime: "0" });
		const first = await sync({ snapshots: [{ index: 7, transfers: [transfer(0, 0)] }] });
		expect(first.json.data).toMatchObject({ ok: true, watch: [7] });
		expect(await h.inspect.storage.get("invoices", "inv_7")).toMatchObject({ status: "confirming" });
		await sync({ height: H0 + 2, snapshots: [{ index: 7, transfers: [transfer(2, H0 + 1)] }] });
		expect(await h.inspect.storage.get("invoices", "inv_7")).toMatchObject({ status: "settled" });

		await h.restart();
		expect(await h.inspect.storage.get("invoices", "inv_7")).toMatchObject({ status: "settled" });

		// The payment vanishes in a reorg: review (reversed) and an alert for the admin page.
		await sync({ height: H0 + 2, snapshots: [{ index: 7, transfers: [] }] });
		expect(await h.inspect.storage.get("invoices", "inv_7")).toMatchObject({ status: "review", reviewReason: "reversed" });
		expect(await h.inspect.kv.get("state:alerts")).toEqual([expect.objectContaining({ invoiceId: "inv_7", kind: "reversed" })]);
	});

	it("pairs through the route and stores the key", async () => {
		host = await createPluginRuntimeTestHost();
		const { code, state } = await newPairingCode(Date.now());
		await host.fixtures.plugin.kv("state:pairing", state);
		const r = await sync({ pair: { code, publicKey: PUBLIC_KEYS.test1 } });
		expect(r.json).toMatchObject({ success: true, data: { ok: true } });
		expect(await host.inspect.setting("bridgePublicKey")).toBe(PUBLIC_KEYS.test1);
		expect(await host.inspect.kv.get("state:pairing")).toMatchObject({ used: true });
	});

	it("forged requests change nothing", async () => {
		const h = await paired();
		const r = await sync({ addresses: [{ index: 1, address: ADDR(1) }] }, "test2");
		expect(r.json).toMatchObject({ success: true, data: { error: { code: "BAD_SIGNATURE" } } });
		expect(await h.inspect.storage.list("pool")).toEqual([]);
	});

	it("the host refuses a body over the declared 256 KiB before the plugin runs", async ({ task }) => {
		await paired();
		const now = Date.now();
		const bytes = new Uint8Array(256 * 1024 + 1).fill(0x20);
		const res = await (host as PluginRuntimeTestHost).actions.routes.request("bridge/sync", { method: "POST", rawBody: bytes, headers: await signedHeaders(bytes, now) });
		const json = (await res.json()) as any;
		Object.assign(task.meta, { status: res.status, json });
		expect(res.status).not.toBe(200);
		expect(json.success).toBe(false);
	});
});

describe("housekeeping and the backup cron", () => {
	it("each sync purges buyer data from invoices final for 30 days, and only those", async () => {
		const h = await paired();
		const old = Date.now() - PURGE_MS - 3_600_000;
		await claimedInvoice(h, 8, { status: "expired", expiresAt: old, finalAt: old, buyer: { email: "a@example.invalid" } });
		await claimedInvoice(h, 9, { status: "expired", expiresAt: old, finalAt: Date.now() - 1000, buyer: { email: "b@example.invalid" } });
		await sync({});
		expect(((await h.inspect.storage.get("invoices", "inv_8")) as Invoice).buyer).toBeUndefined();
		expect(((await h.inspect.storage.get("invoices", "inv_9")) as Invoice).buyer).toEqual({ email: "b@example.invalid" });
	});

	it("activation and the first admin page load schedule the backup cron; it purges too", async ({ task }) => {
		host = await createPluginRuntimeTestHost();
		expect(await host.inspect.scheduledTasks()).toEqual([]);
		await host.admin.loadPage("/payments");
		const afterAdmin = await host.inspect.scheduledTasks();
		Object.assign(task.meta, { afterAdmin });
		expect(afterAdmin).toEqual([expect.objectContaining({ name: "housekeeping", schedule: "0 * * * *" })]);
		await host.actions.plugin.activate();
		expect(await host.inspect.scheduledTasks()).toHaveLength(1); // idempotent

		const old = Date.now() - PURGE_MS - 3_600_000;
		await claimedInvoice(host, 5, { status: "expired", expiresAt: old, finalAt: old, buyer: { note: "hi" } });
		host.scheduled.setTime(new Date(Date.parse(String(afterAdmin[0].nextRunAt ?? afterAdmin[0].next_run_at)) + 1000));
		const run = await host.scheduled.run();
		Object.assign(task.meta, { run });
		expect(((await host.inspect.storage.get("invoices", "inv_5")) as Invoice).buyer).toBeUndefined();
	});
});
