// The admin page's invoice table and row actions (phase 04 session 4c), through the runtime host's admin helpers,
// which also validate every Block Kit response.
import { afterEach, describe, expect, it } from "vitest";

import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";

import { MAX_REQUIRED } from "../../src/core/constants";
import { type Invoice, type Transfer, newInvoice } from "../../src/core/invoice";
import { PUBLIC_KEYS, bytesOf, signedHeaders } from "../sync/helpers";

let host: PluginRuntimeTestHost | undefined;
afterEach(async () => {
	await host?.dispose();
	host = undefined;
});

type B = Record<string, any>;
const H0 = 3_000_000;
const KRAKEN = "https://api.kraken.com/0/public/Ticker?pair=XMRUSD";
const ADDR = (i: number) => `7${String(i).padStart(94, "F")}`;
const T0 = Date.now() - 3_600_000;

function invoice(n: number, over: Partial<Invoice> = {}): Invoice {
	const inv = newInvoice({ id: `inv_${String(n).padStart(4, "0")}`, token: `t${String(n).padStart(21, "0")}`, kind: "product", fiatMinor: 1200n, currency: "USD", rate: { minor: 15000n, source: "api.kraken.com" }, speed: "standard", subaddress: ADDR(n), addrIndex: n, now: T0 + n * 1000, chainHeight: H0 });
	return { ...inv, ...over };
}
const transfer = (over: Partial<Transfer> = {}): Transfer => ({ txid: "ab".repeat(32), amountAtomic: "80000000000", confirmations: 3, height: H0 + 2, timestamp: 1_790_000_100, doubleSpendSeen: false, unlockTime: "0", seenAt: T0, poolTs: null, ...over });

async function setup(invoices: Invoice[] = []) {
	const h = await createPluginRuntimeTestHost();
	host = h;
	await h.fixtures.plugin.setting("bridgePublicKey", PUBLIC_KEYS.test1);
	await h.fixtures.plugin.kv("state:bridge", { height: H0 + 5, lastSyncAt: Date.now() - 30_000, version: 1, outdated: false });
	await h.fixtures.plugin.storage("pool", "9999", { addrIndex: 9999, address: ADDR(9999), status: "free" });
	await h.http.respond(KRAKEN, new Response(JSON.stringify({ error: [], result: { XXMRZUSD: { c: ["150.00", "1.0"] } } })));
	for (let i = 0; i < invoices.length; i += 50) await Promise.all(invoices.slice(i, i + 50).map((inv) => h.fixtures.plugin.storage("invoices", inv.id, inv)));
	return h;
}

const load = async () => (await (host as PluginRuntimeTestHost).admin.loadPage("/payments")).blocks as B[];
const table = (blocks: B[]) => blocks.find((b) => b.type === "table" && b.block_id === "invoices") as B;
const row = (blocks: B[], id: string) => table(blocks).rows.find((r: B) => r.id === id) as B;
const menuValues = (r: B) => (r.actions?.items ?? []).map((i: B) => i.value as string);
const act = (value: unknown, actionId = "invoice_action") => (host as PluginRuntimeTestHost).admin.act("/payments", actionId, { value });
const stored = async (id: string) => (await (host as PluginRuntimeTestHost).inspect.storage.get<Invoice>("invoices", id)) as Invoice;

describe("invoice table", () => {
	it("no product invoices: an empty table that says so", async () => {
		await setup();
		expect(table(await load())).toMatchObject({ page_action_id: "invoices_page", rows: [], empty_text: "No orders yet." });
	});

	it("one row per product invoice, newest first, tips left out; amounts, received, confirmations and times", async () => {
		await setup([
			invoice(1),
			invoice(2, { status: "confirming", transfers: [transfer({ confirmations: 1 })] }),
			invoice(3, { status: "review", reviewReason: "underpaid", transfers: [transfer({ amountAtomic: "40000000000", confirmations: 7 })] }),
			{ ...invoice(4), kind: "tip", fiat: null, expectedAtomic: null, minAtomic: "100000000" },
		]);
		const t = table(await load());
		expect(t.columns.map((c: B) => [c.key, c.format ?? "text"])).toEqual([
			["status", "badge"], ["amount", "text"], ["xmr", "text"], ["received", "text"], ["confirmations", "text"], ["created", "relative_time"], ["expires", "relative_time"], ["actions", "element"],
		]);
		expect(t.rows.map((r: B) => r.id)).toEqual(["inv_0003", "inv_0002", "inv_0001"]);
		expect(row(await load(), "inv_0003")).toMatchObject({ status: "Needs decision: underpaid", amount: "12.00 USD", xmr: "0.080000000000", received: "0.040000000000", confirmations: "7 (needs 2)" });
		expect(row(await load(), "inv_0002")).toMatchObject({ status: "Confirming", received: "0.080000000000", confirmations: "1 (needs 2)" });
		const first = row(await load(), "inv_0001");
		expect(first).toMatchObject({ status: "New", received: "0", confirmations: "None yet (needs 2)" });
		expect(first.created).toBe(new Date(T0 + 1000).toISOString());
		expect(first.expires).toBe(new Date(T0 + 1000 + 30 * 60_000).toISOString());
	});

	it("pages of 25: Load more shows the next page, and a button goes back to the newest", async () => {
		await setup(Array.from({ length: 30 }, (_, i) => invoice(i + 1)));
		const t = table(await load());
		expect(t.rows).toHaveLength(25);
		expect(t.rows[0].id).toBe("inv_0030");
		expect(typeof t.next_cursor).toBe("string");
		const next = table((await act({ cursor: t.next_cursor }, "invoices_page")).blocks as B[]);
		expect(next.rows.map((r: B) => r.id)).toEqual(["inv_0005", "inv_0004", "inv_0003", "inv_0002", "inv_0001"]);
		expect(next.next_cursor).toBeUndefined();
		const blocks = (await act({ cursor: t.next_cursor }, "invoices_page")).blocks as B[];
		expect(blocks.find((b) => b.type === "actions" && b.block_id === "invoices_nav")?.elements[0]).toMatchObject({ action_id: "invoices_newest", label: "Newest invoices" });
		expect(table((await act(undefined, "invoices_newest")).blocks as B[]).rows[0].id).toBe("inv_0030");
		// A malformed cursor shows the first page, not an error.
		expect(table((await act({ cursor: 42 }, "invoices_page")).blocks as B[]).rows[0].id).toBe("inv_0030");
	});

	it("each row's menu offers only what fits its state", async () => {
		await setup([
			invoice(1),
			invoice(2, { status: "review", reviewReason: "late", transfers: [transfer()] }),
			invoice(3, { status: "settled", settledAt: T0, transfers: [transfer()] }),
			invoice(4, { status: "expired" }),
			invoice(5, { required: MAX_REQUIRED }),
			invoice(6, { status: "settled", settledAt: T0, adminFinal: true, transfers: [transfer()] }),
		]);
		const b = await load();
		expect(menuValues(row(b, "inv_0001"))).toEqual(["settle:inv_0001", "expire:inv_0001", "raise:inv_0001", "details:inv_0001"]);
		expect(menuValues(row(b, "inv_0002"))).toEqual(["settle:inv_0002", "expire:inv_0002", "details:inv_0002"]);
		expect(menuValues(row(b, "inv_0003"))).toEqual(["details:inv_0003"]);
		expect(menuValues(row(b, "inv_0004"))).toEqual(["settle:inv_0004", "details:inv_0004"]);
		expect(menuValues(row(b, "inv_0005"))).toEqual(["settle:inv_0005", "expire:inv_0005", "details:inv_0005"]);
		expect(menuValues(row(b, "inv_0006"))).toEqual(["details:inv_0006"]);
		expect(row(b, "inv_0006").status).toBe("Settled (by admin)");
	});
});

describe("review invoices in the table (click-through changes 6 to 8)", () => {
	it("status reads Needs decision with the reason; a gone payment's confirmations say so", async () => {
		await setup([
			invoice(1, { status: "review", reviewReason: "late", transfers: [transfer()] }),
			invoice(2, { status: "review", reviewReason: "underpaid", transfers: [transfer({ amountAtomic: "1" })] }),
			invoice(3, { status: "review", reviewReason: "reorg", transfers: [transfer({ confirmations: 0, height: 0 })] }),
			invoice(4, { status: "review", reviewReason: "reversed", settledAt: T0 }),
		]);
		const b = await load();
		expect(["inv_0001", "inv_0002", "inv_0003", "inv_0004"].map((id) => row(b, id).status)).toEqual(["Needs decision: late", "Needs decision: underpaid", "Needs decision: reorg", "Needs decision: reversed"]);
		expect(row(b, "inv_0003").confirmations).toBe("Not mined again (needed 2)");
		expect(row(b, "inv_0004").confirmations).toBe("No longer reported (needed 2)");
	});

	it("details: an Open product link to the product's editor when the invoice has a productRef, none without", async () => {
		await setup([invoice(1, { productRef: { collection: "products", id: "prod_abc" } }), invoice(2)]);
		const panel = async (id: string) => ((await act(`details:${id}`)).blocks as B[]).find((b) => b.type === "accordion" && b.block_id === "invoice_details") as B;
		const links = (p: B) => p.blocks.filter((b: B) => b.type === "actions").flatMap((b: B) => b.elements).filter((e: B) => e.type === "link");
		expect(links(await panel("inv_0001"))).toEqual([{ type: "link", label: "Open product", target: { kind: "content", collection: "products", id: "prod_abc" } }]);
		expect(links(await panel("inv_0002"))).toEqual([]);
	});
});

describe("row actions", () => {
	it("mark settled: final, and a later sync leaves it alone", async () => {
		const h = await setup([invoice(1, { status: "review", reviewReason: "underpaid", transfers: [transfer({ amountAtomic: "40000000000" })] })]);
		const r = await act("settle:inv_0001");
		expect(r.toast).toEqual({ type: "success", message: "Marked settled. The invoice won't change again." });
		const inv = await stored("inv_0001");
		expect(inv).toMatchObject({ status: "settled", adminFinal: true });
		expect(inv.settledAt).toBeGreaterThan(0);
		expect(inv.finalAt).toBeGreaterThan(0);
		expect(inv.reviewReason).toBeUndefined();
		// A sync reporting the payment gone changes nothing: the decision is final.
		await h.fixtures.plugin.storage("pool", "1", { addrIndex: 1, address: ADDR(1), status: "claimed", invoiceId: "inv_0001" });
		const now = Date.now();
		const bytes = bytesOf({ v: 1, seq: now, height: H0 + 9, addresses: [], snapshots: [{ index: 1, transfers: [] }] });
		await h.actions.routes.request("bridge/sync", { method: "POST", rawBody: bytes, headers: await signedHeaders(bytes, now) });
		expect(await stored("inv_0001")).toMatchObject({ status: "settled", adminFinal: true });
	});

	it("expire: final", async () => {
		await setup([invoice(1)]);
		expect((await act("expire:inv_0001")).toast).toEqual({ type: "success", message: "Expired. The invoice won't change again." });
		expect(await stored("inv_0001")).toMatchObject({ status: "expired", adminFinal: true });
	});

	it(`raise confirmations: to ${MAX_REQUIRED} on an open invoice, never lower, and the invoice stays open`, async () => {
		await setup([invoice(1)]);
		expect((await act("raise:inv_0001")).toast).toEqual({ type: "success", message: `This invoice now needs ${MAX_REQUIRED} confirmations.` });
		const inv = await stored("inv_0001");
		expect(inv).toMatchObject({ status: "new", required: MAX_REQUIRED });
		expect(inv.adminFinal).toBeUndefined();
		expect((await act("raise:inv_0001")).toast).toMatchObject({ type: "error" });
		expect((await stored("inv_0001")).required).toBe(MAX_REQUIRED);
	});

	it("stale state: an invoice that changed since the page loaded is refused, and nothing changes", async () => {
		const h = await setup([invoice(1), invoice(2, { status: "confirming", transfers: [transfer({ confirmations: 1 })] })]);
		await load();
		// It settled on its own in the meantime.
		await h.fixtures.plugin.storage("invoices", "inv_0001", invoice(1, { status: "settled", settledAt: Date.now(), transfers: [transfer()] }));
		const r = await act("settle:inv_0001");
		expect(r.toast).toEqual({ type: "error", message: "This invoice changed since the page loaded (it's now settled). Nothing was changed." });
		expect((await stored("inv_0001")).adminFinal).toBeUndefined();
		// Expired before the raise.
		await h.fixtures.plugin.storage("invoices", "inv_0002", invoice(2, { status: "expired" }));
		expect((await act("raise:inv_0002")).toast).toEqual({ type: "error", message: "This invoice changed since the page loaded (it's now expired). Nothing was changed." });
		expect((await stored("inv_0002")).required).toBe(2);
	});

	it("unknown invoices and malformed values: an error toast, nothing changes", async () => {
		await setup([invoice(1)]);
		for (const value of ["settle:inv_9999", "explode:inv_0001", "settle", 42, null, { id: "inv_0001" }]) {
			expect((await act(value)).toast).toMatchObject({ type: "error" });
		}
		expect(await stored("inv_0001")).toMatchObject({ status: "new" });
	});

	it("details: every transfer's txid as copyable text, with why a transfer doesn't count; buyer text as plain text", async () => {
		await setup([invoice(1, {
			status: "seen",
			buyer: { email: "a@example.invalid", refundAddress: ADDR(5) },
			transfers: [transfer({ txid: "aa".repeat(32), amountAtomic: "10000000000" }), transfer({ txid: "bb".repeat(32), unlockTime: "3000100" }), transfer({ txid: "cc".repeat(32), doubleSpendSeen: true, confirmations: 0, height: 0 })],
		})]);
		const r = await act("details:inv_0001");
		const panel = (r.blocks as B[]).find((b) => b.type === "accordion" && b.block_id === "invoice_details") as B;
		expect(panel).toMatchObject({ label: "Invoice inv_0001", default_open: true });
		const inner = JSON.stringify(panel.blocks);
		expect(panel.blocks.filter((b: B) => b.type === "code").map((b: B) => b.code)).toEqual(["aa".repeat(32), "bb".repeat(32), "cc".repeat(32)]);
		expect(inner).toContain("0.010000000000 XMR, 3 confirmations, counted");
		expect(inner).toContain("not counted: time-locked until block 3000100");
		expect(inner).toContain("not counted: flagged as a possible double spend");
		expect(inner).toContain("a@example.invalid");
		expect(panel.blocks.find((b: B) => b.type === "fields")?.fields).toContainEqual({ label: "Refund address", value: ADDR(5) });
		expect(r.toast).toBeUndefined();
	});
});

describe("limits", () => {
	// 300 storage fixtures: 0.9 s on the dev box; CI ran 7x slower once (run 37866556943), so this test gets 30 s.
	it("a site with 300 invoices: one page of 25 rows, inside Block Kit's limits", { timeout: 30_000 }, async () => {
		await setup(Array.from({ length: 300 }, (_, i) => invoice(i + 1, i % 3 === 0 ? { status: "review", reviewReason: "late", transfers: [transfer()] } : {})));
		const page = await (host as PluginRuntimeTestHost).admin.loadPage("/payments");
		const blocks = page.blocks as B[];
		expect(table(blocks).rows).toHaveLength(25);
		const json = JSON.stringify(page);
		expect(json.length).toBeLessThan(256 * 1024);
		// EmDash counts every value as a node (validateResponseBounds), strings and numbers included.
		let nodes = 0;
		const walk = (v: unknown) => {
			nodes++;
			if (Array.isArray(v)) {
				expect(v.length).toBeLessThan(1000);
				v.forEach(walk);
			} else if (v && typeof v === "object") Object.values(v).forEach(walk);
		};
		walk(page);
		expect(nodes).toBeLessThan(2000);
	});
});
