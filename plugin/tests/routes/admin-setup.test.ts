// The admin page's setup checklist, Get a test address, pairing notes and the bridge key (phase 04 session 4b),
// through the runtime host's admin helpers, which also validate every Block Kit response.
import { afterEach, describe, expect, it } from "vitest";

import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";

import type { Invoice } from "../../src/core/invoice";
import { PUBLIC_KEYS, bytesOf, signedHeaders } from "../sync/helpers";

let host: PluginRuntimeTestHost | undefined;
afterEach(async () => {
	await host?.dispose();
	host = undefined;
});

type B = Record<string, any>;
const H0 = 3_000_000;
const KRAKEN = "https://api.kraken.com/0/public/Ticker?pair=XMRUSD";
const krakenOk = () => new Response(JSON.stringify({ error: [], result: { XXMRZUSD: { c: ["150.00", "1.0"] } } }));
const ADDR = (i: number) => `7${String(i).padStart(94, "E")}`;

async function setup(o: { paired?: boolean; lastSyncAgo?: number | null; free?: number; price?: boolean } = {}) {
	const h = await createPluginRuntimeTestHost();
	host = h;
	if (o.paired !== false) await h.fixtures.plugin.setting("bridgePublicKey", PUBLIC_KEYS.test1);
	const ago = o.lastSyncAgo === undefined ? 30_000 : o.lastSyncAgo;
	if (ago !== null) await h.fixtures.plugin.kv("state:bridge", { height: H0, lastSyncAt: Date.now() - ago, version: 1, outdated: false });
	for (let i = 1; i <= (o.free ?? 3); i++) await h.fixtures.plugin.storage("pool", String(i), { addrIndex: i, address: ADDR(i), status: "free" });
	if (o.price !== false) await h.http.respond(KRAKEN, krakenOk());
	else for (const url of [KRAKEN, "https://api.coingecko.com/api/v3/simple/price?ids=monero&vs_currencies=usd"]) await h.http.respond(url, new Response("down", { status: 502 }));
	return h;
}

const load = async () => (await (host as PluginRuntimeTestHost).admin.loadPage("/payments")).blocks as B[];
const checklist = (blocks: B[]) => blocks.find((b) => b.type === "accordion" && b.block_id === "setup") as B | undefined;
const items = (blocks: B[]) => (checklist(blocks)?.blocks.find((b: B) => b.type === "fields")?.fields ?? []) as Array<{ label: string; value: string }>;
const text = (blocks: B[]) => JSON.stringify(blocks);
const tips = async () => (await (host as PluginRuntimeTestHost).inspect.storage.list<Invoice>("invoices")).map((i) => i.data).filter((i) => i.kind === "tip");

async function pair(h: PluginRuntimeTestHost, key: "test1" | "test2") {
	const r = await h.admin.act("/payments", "connect_wallet_host");
	const cmd = (r.blocks as B[]).find((b) => b.type === "code" && String(b.code).startsWith("curl"))?.code as string;
	const code = cmd.match(/--pair ([A-Za-z0-9_-]{22})$/)?.[1];
	const now = Date.now();
	const bytes = bytesOf({ v: 1, seq: now, height: H0, addresses: [], snapshots: [], pair: { code, publicKey: PUBLIC_KEYS[key] } });
	const res = await h.actions.routes.request("bridge/sync", { method: "POST", rawBody: bytes, headers: await signedHeaders(bytes, now, key) });
	expect(((await res.json()) as B).data).toMatchObject({ ok: true });
}

describe("setup checklist", () => {
	it("a fresh site: five items, each saying what to do next, open", async () => {
		await setup({ paired: false, lastSyncAgo: null, free: 0, price: false });
		const b = await load();
		expect(checklist(b)).toMatchObject({ label: "Setup: 0 of 5 done", default_open: true });
		expect(items(b)).toEqual([
			{ label: "Wallet host paired", value: "To do: press Connect wallet host below and run the command on your wallet host." },
			{ label: "Wallet synced", value: "To do: the wallet host syncs within a minute of pairing." },
			{ label: "Payment addresses ready", value: "To do: the wallet host adds them at its first sync." },
			{ label: "Price feed answering", value: "To do: both price services failed just now; this page checks again when it loads." },
			{ label: "Test tip received", value: "To do: once the items above are done, press Get a test address and send at least 0.0001 XMR to it." },
		]);
		expect(text(b)).not.toContain("get_test_address");
	});

	it("a paired, synced site: four of five done, and the Get a test address button", async () => {
		await setup();
		const b = await load();
		expect(checklist(b)).toMatchObject({ label: "Setup: 4 of 5 done", default_open: true });
		expect(items(b).slice(0, 4).map((i) => i.value)).toEqual(["Done", "Done", "Done", "Done"]);
		const button = checklist(b)?.blocks.find((x: B) => x.type === "actions")?.elements[0];
		expect(button).toMatchObject({ type: "button", action_id: "get_test_address", label: "Get a test address" });
	});

	it("a silent wallet host: synced is to do again", async () => {
		await setup({ lastSyncAgo: 12 * 60_000 });
		expect(items(await load())[1]).toEqual({ label: "Wallet synced", value: "To do: the wallet host is silent. On the wallet host, run: xmr-bridge status" });
	});

	it("Get a test address: an open tip invoice on a pool address, shown as copyable text; pressing again reuses it", async () => {
		const h = await setup();
		const r = await h.admin.act("/payments", "get_test_address");
		expect(r.toast).toMatchObject({ type: "success" });
		const [tip] = await tips();
		expect(tip).toMatchObject({ kind: "tip", status: "new", minAtomic: "100000000", expectedAtomic: null, addrIndex: 1, subaddress: ADDR(1), createdHeight: H0 });
		expect(await h.inspect.storage.get("pool", "1")).toMatchObject({ status: "claimed", invoiceId: tip.id });
		const codes = (checklist(r.blocks as B[])?.blocks ?? []).filter((x: B) => x.type === "code").map((x: B) => x.code);
		expect(codes).toEqual([ADDR(1), `monero:${ADDR(1)}?tx_amount=0.000100000000&tx_description=Coffer%20test%20tip`]);
		expect(text(r.blocks as B[])).toContain("Send at least 0.0001 XMR to this address from any wallet");
		expect(text(r.blocks as B[])).toContain("Waiting for the payment");

		// A reload shows it again; pressing again keeps the same address instead of using up another.
		expect((checklist(await load())?.blocks ?? []).some((x: B) => x.type === "code" && x.code === ADDR(1))).toBe(true);
		await h.admin.act("/payments", "get_test_address");
		expect(await tips()).toHaveLength(1);
		expect(await h.inspect.storage.get("pool", "2")).toMatchObject({ status: "free" });
	});

	it("Get a test address is refused while the wallet host is silent or no address is free, claiming nothing", async () => {
		const h = await setup({ lastSyncAgo: 12 * 60_000 });
		const r = await h.admin.act("/payments", "get_test_address");
		expect(r.toast).toEqual({ type: "error", message: "The wallet host must be syncing first. On the wallet host, run: xmr-bridge status" });
		expect(await tips()).toEqual([]);
		await h.dispose();
		const h2 = await setup({ free: 0 });
		expect((await h2.admin.act("/payments", "get_test_address")).toast).toEqual({ type: "error", message: "No payment address is free yet. The wallet host adds them at its next sync; try again in a minute." });
		expect(await tips()).toEqual([]);
	});

	it("after the test address expires unpaid, the button makes a new one on the next address", async () => {
		const h = await setup();
		await h.admin.act("/payments", "get_test_address");
		const [old] = await tips();
		await h.fixtures.plugin.storage("invoices", old.id, { ...old, status: "expired" });
		await h.admin.act("/payments", "get_test_address");
		const all = await tips();
		expect(all).toHaveLength(2);
		expect(all.find((t) => t.id !== old.id)).toMatchObject({ status: "new", addrIndex: 2 });
	});

	it("a seen test tip shows its progress; a settled one completes setup, and the checklist collapses for good", async () => {
		const h = await setup();
		await h.admin.act("/payments", "get_test_address");
		const [tip] = await tips();
		const transfer = { txid: "ab".repeat(32), amount: "200000000", amountAtomic: "200000000", confirmations: 1, height: H0 + 1, timestamp: 1_790_000_100, doubleSpendSeen: false, unlockTime: "0", seenAt: 1, poolTs: 1 };
		await h.fixtures.plugin.storage("invoices", tip.id, { ...tip, status: "confirming", transfers: [transfer] });
		expect(text(await load())).toContain(`Payment seen: 1 of ${tip.required} confirmations`);
		await h.fixtures.plugin.storage("invoices", tip.id, { ...tip, status: "settled", settledAt: Date.now(), transfers: [{ ...transfer, confirmations: tip.required }] });
		let b = await load();
		expect(checklist(b)).toMatchObject({ label: "Setup (complete)", default_open: false });
		expect(items(b)[4]).toEqual({ label: "Test tip received", value: "Done" });
		expect(await h.inspect.kv.get("state:setupDone")).toBe(true);
		// Collapsed for good: even with the wallet host silent later (the health panel covers that).
		await h.fixtures.plugin.kv("state:bridge", { height: H0, lastSyncAt: Date.now() - 60 * 60_000, version: 1, outdated: false });
		b = await load();
		expect(checklist(b)).toMatchObject({ label: "Setup (complete)", default_open: false });
	});
});

describe("pairing notes", () => {
	it("the code's minutes left, at issue and on a reload; an expired code no longer counts as active", async () => {
		const h = await setup({ paired: false, lastSyncAgo: null });
		const r = await h.admin.act("/payments", "connect_wallet_host");
		expect(text(r.blocks as B[])).toContain("15 min left");
		const state = (await h.inspect.kv.get<B>("state:pairing")) as B;
		await h.fixtures.plugin.kv("state:pairing", { ...state, expiresAt: Date.now() + 5 * 60_000 + 30_000 });
		expect(text(await load())).toMatch(/A pairing code is active until \d\d:\d\d UTC \(5 min left\)/);
		await h.fixtures.plugin.kv("state:pairing", { ...state, expiresAt: Date.now() - 1000 });
		const b = await load();
		expect(text(b)).not.toContain("A pairing code is active");
		expect(text(b)).toContain("Creates a one-time code (15 minutes)");
	});

	it("a completed pairing says when; one that replaced a key says so", async () => {
		const h = await setup({ paired: false, lastSyncAgo: null });
		await pair(h, "test1");
		expect(await h.inspect.kv.get("state:lastPairing")).toMatchObject({ replaced: false });
		let b = await load();
		expect(text(b)).toMatch(/Wallet host paired at \d\d:\d\d UTC\./);
		expect(text(b)).not.toContain("replacing");
		await pair(h, "test2");
		expect(await h.inspect.kv.get("state:lastPairing")).toMatchObject({ replaced: true });
		b = await load();
		expect(text(b)).toMatch(/Wallet host paired at \d\d:\d\d UTC, replacing the previous one, which no longer syncs\./);
	});
});

describe("settings: the bridge key", () => {
	it("shown read-only when paired, Not paired otherwise", async () => {
		await setup();
		const keyField = (b: B[]) => b.find((x) => x.type === "fields" && x.block_id === "bridge_key")?.fields[0];
		const b = await load();
		expect(keyField(b)).toEqual({ label: "Bridge public key", value: PUBLIC_KEYS.test1 });
		// No paste-by-hand form (spec change 19); the wallet host prints the same key.
		expect(JSON.stringify(b)).toContain("On the wallet host, xmr-bridge status prints the same key.");
		expect(b.some((x) => x.type === "form" && x.block_id !== "settings")).toBe(false);
		await host?.dispose();
		await setup({ paired: false });
		expect(keyField(await load())).toEqual({ label: "Bridge public key", value: "Not paired" });
	});
});
