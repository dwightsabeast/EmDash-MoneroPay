// The admin page's invoice list and its actions (phase 04 session 4c, reworked after Wyatt's second click-through,
// ~/xmr-pay-dev-data/04-ui-2/notes.md changes 1, 2, 4, 5 and 6): one closed toggle per product invoice, 10 a page, with
// the summary as its label and the details and the Actions menu inside. Through the runtime host's admin helpers, which
// also validate every Block Kit response.
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
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// 12.00 USD at 150.00 USD/XMR.
const DUE = "0.080000000000";

function invoice(n: number, over: Partial<Invoice> = {}): Invoice {
	const inv = newInvoice({ id: `inv_${String(n).padStart(4, "0")}`, token: `t${String(n).padStart(21, "0")}`, kind: "product", fiatMinor: 1200n, currency: "USD", rate: { minor: 15000n, source: "api.kraken.com" }, speed: "standard", subaddress: ADDR(n), addrIndex: n, now: T0 + n * 1000, chainHeight: H0 });
	return { ...inv, ...over };
}
const transfer = (over: Partial<Transfer> = {}): Transfer => ({ txid: "ab".repeat(32), amountAtomic: "80000000000", confirmations: 3, height: H0 + 2, timestamp: 1_790_000_100, doubleSpendSeen: false, unlockTime: "0", seenAt: T0, poolTs: null, ...over });
/** Created this long ago, plus ten minutes so the label doesn't sit on a boundary. */
const createdAgo = (ms: number) => ({ createdAt: Date.now() - ms - 10 * 60_000 });

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
const items = (blocks: B[]) => blocks.filter((b) => b.type === "accordion" && /^invoice_inv_/.test(String(b.block_id)));
const item = (blocks: B[], id: string) => items(blocks).find((b) => b.block_id === `invoice_${id}` || b.block_id === `invoice_${id}_acted`) as B;
const ids = (blocks: B[]) => items(blocks).map((b) => String(b.block_id).replace(/^invoice_/, "").replace(/_acted$/, ""));
const menu = (t: B) => t.blocks.filter((b: B) => b.type === "actions").flatMap((b: B) => b.elements).find((e: B) => e.type === "menu") as B | undefined;
const menuValues = (t: B) => (menu(t)?.items ?? []).map((i: B) => i.value as string);
const fieldsOf = (t: B) => t.blocks.filter((b: B) => b.type === "fields").flatMap((b: B) => b.fields) as Array<{ label: string; value: string }>;
const field = (t: B, label: string) => fieldsOf(t).find((f) => f.label === label)?.value;
const nav = (blocks: B[]) => (blocks.find((b) => b.type === "actions" && b.block_id === "invoices_nav")?.elements ?? []) as B[];
const act = (value: unknown, actionId = "invoice_action") => (host as PluginRuntimeTestHost).admin.act("/payments", actionId, { value });
const stored = async (id: string) => (await (host as PluginRuntimeTestHost).inspect.storage.get<Invoice>("invoices", id)) as Invoice;
/** Every block in a toggle, depth first, so a check can't miss a nested fields block. */
const deep = (bs: B[]): B[] => bs.flatMap((b) => [b, ...(Array.isArray(b.blocks) ? deep(b.blocks) : [])]);

describe("invoice list", () => {
	it("no product invoices: a line that says so, no toggles", async () => {
		await setup();
		const b = await load();
		expect(items(b)).toEqual([]);
		expect(b.find((x) => x.type === "context" && x.block_id === "invoices_empty")?.text).toBe("No orders yet.");
	});

	it("one closed toggle per product invoice, newest first, tips left out", async () => {
		await setup([invoice(1), invoice(2), invoice(3), { ...invoice(4), kind: "tip", fiat: null, expectedAtomic: null, minAtomic: "100000000" }]);
		const b = await load();
		expect(ids(b)).toEqual(["inv_0003", "inv_0002", "inv_0001"]);
		for (const t of items(b)) expect(t).toMatchObject({ type: "accordion", default_open: false });
		expect(b.some((x) => x.type === "table")).toBe(false);
	});

	it("labels: the summary on one line, Due and Received marked, no expiry (change 1)", async () => {
		await setup([
			invoice(1, { status: "settled", settledAt: T0, transfers: [transfer({ confirmations: 36 })], ...createdAgo(20 * HOUR) }),
			invoice(2, { status: "expired", ...createdAgo(DAY) }),
			invoice(3, { status: "review", reviewReason: "underpaid", transfers: [transfer({ amountAtomic: "40000000000", confirmations: 94 })], ...createdAgo(3 * DAY) }),
			invoice(4, { status: "review", reviewReason: "late", transfers: [transfer({ confirmations: 1 })], ...createdAgo(2 * HOUR) }),
			invoice(5, { status: "review", reviewReason: "reversed", settledAt: T0, ...createdAgo(2 * DAY) }),
			invoice(6, { status: "review", reviewReason: "reorg", transfers: [transfer({ confirmations: 0, height: 0 })], ...createdAgo(2 * DAY) }),
			invoice(7, { status: "settled", settledAt: T0, adminFinal: true, ...createdAgo(DAY) }),
			invoice(8, { status: "seen", transfers: [transfer({ confirmations: 0, height: 0 })], createdAt: Date.now() - 5 * 60_000 - 10_000 }),
		]);
		const b = await load();
		const label = (id: string) => item(b, id).label;
		expect(label("inv_0001")).toBe(`Settled · 12.00 USD · received ${DUE} XMR · 36 confirmations · created 20 hours ago`);
		expect(label("inv_0002")).toBe(`Expired · 12.00 USD · nothing received (${DUE} XMR due) · created 1 day ago`);
		expect(label("inv_0003")).toBe(`Needs decision: underpaid · 12.00 USD · received 0.040000000000 of ${DUE} XMR · 94 confirmations · created 3 days ago`);
		expect(label("inv_0004")).toBe(`Needs decision: late · 12.00 USD · received ${DUE} XMR · 1 confirmation · created 2 hours ago`);
		expect(label("inv_0005")).toBe("Needs decision: reversed · 12.00 USD · payment no longer reported · created 2 days ago");
		expect(label("inv_0006")).toBe("Needs decision: reorg · 12.00 USD · payment not mined again · created 2 days ago");
		expect(label("inv_0007")).toBe(`Settled (by admin) · 12.00 USD · nothing received (${DUE} XMR due) · created 1 day ago`);
		expect(label("inv_0008")).toBe(`Seen · 12.00 USD · received ${DUE} XMR · 0 confirmations · created 5 min ago`);
	});

	it("details: status, amount, Due, Received, confirmations, created, expires (changes 1 and 6)", async () => {
		await setup([invoice(1, { status: "confirming", transfers: [transfer({ amountAtomic: "40000000000", confirmations: 1 })] })]);
		const t = item(await load(), "inv_0001");
		expect(fieldsOf(t).map((f) => f.label)).toEqual(["Status", "Amount", "Due", "Received", "Confirmations", "Created", "Expires"]);
		expect(field(t, "Status")).toBe("Confirming");
		expect(field(t, "Amount")).toBe("12.00 USD");
		expect(field(t, "Due")).toBe(`${DUE} XMR`);
		expect(field(t, "Received")).toBe("0.040000000000 XMR");
		expect(field(t, "Confirmations")).toBe("1 (needs 2)");
		expect(field(t, "Created")).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d\d:\d\d UTC$/);
		// Open invoices keep showing when they expire.
		expect(field(t, "Expires")).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d\d:\d\d UTC$/);
	});

	it("expires reads — once an invoice is final: settled, expired, or decided by the admin (change 6)", async () => {
		await setup([
			invoice(1, { status: "settled", settledAt: T0, transfers: [transfer()] }),
			invoice(2, { status: "expired" }),
			invoice(3, { status: "expired", adminFinal: true }),
			invoice(4, { status: "settled", settledAt: T0, adminFinal: true }),
			invoice(5, { status: "review", reviewReason: "late", transfers: [transfer()] }),
		]);
		const b = await load();
		for (const id of ["inv_0001", "inv_0002", "inv_0003", "inv_0004"]) expect(field(item(b, id), "Expires")).toBe("—");
		// A review invoice still waits for the admin's decision.
		expect(field(item(b, "inv_0005"), "Expires")).not.toBe("—");
	});

	it("the payment address and the refund address in their own labeled boxes, never cut off in a fields grid (change 2)", async () => {
		await setup([invoice(266, { buyer: { email: "a@example.invalid", refundAddress: ADDR(5), note: "Leave it at the door" } })]);
		const t = item(await load(), "inv_0266");
		const inner = deep(t.blocks);
		const i = inner.findIndex((x) => x.type === "context" && x.text === "Payment address (#266)");
		expect(inner[i + 1]).toEqual({ type: "code", code: ADDR(266) });
		const r = inner.findIndex((x) => x.type === "context" && x.text === "Buyer's refund address");
		expect(inner[r + 1]).toEqual({ type: "code", code: ADDR(5) });
		const labels = inner.filter((x) => x.type === "fields").flatMap((x) => x.fields.map((f: B) => f.label));
		expect(labels).not.toContain("Payment address");
		expect(labels).not.toContain("Refund address");
		expect(JSON.stringify(inner.filter((x) => x.type === "fields"))).not.toContain(ADDR(5));
		// Buyer-supplied text stays plain text.
		expect(field(t, "Buyer email")).toBe("a@example.invalid");
		expect(inner.find((x) => x.type === "context" && String(x.text).startsWith("Buyer's note"))?.text).toBe("Buyer's note: Leave it at the door");
	});

	it("no Product field; the Open product link stays, beside the Actions menu (change 5)", async () => {
		await setup([invoice(1, { productRef: { collection: "products", id: "01M41ST8AY5RV67DPG1H4BW587" } }), invoice(2)]);
		const b = await load();
		const t = item(b, "inv_0001");
		expect(fieldsOf(t).some((f) => f.label === "Product")).toBe(false);
		expect(JSON.stringify(fieldsOf(t))).not.toContain("01M41ST8AY5RV67DPG1H4BW587");
		const elements = t.blocks.filter((x: B) => x.type === "actions").flatMap((x: B) => x.elements) as B[];
		expect(elements.find((e) => e.type === "link")).toEqual({ type: "link", label: "Open product", target: { kind: "content", collection: "products", id: "01M41ST8AY5RV67DPG1H4BW587" } });
		expect(JSON.stringify(item(b, "inv_0002"))).not.toContain("Open product");
	});
});

describe("transaction IDs (change 4)", () => {
	it("each payment with its Transaction ID under it, in one box, and the hint above; why a payment doesn't count", async () => {
		await setup([invoice(1, {
			status: "seen",
			transfers: [transfer({ txid: "aa".repeat(32), amountAtomic: "10000000000" }), transfer({ txid: "bb".repeat(32), unlockTime: "3000100" }), transfer({ txid: "cc".repeat(32), doubleSpendSeen: true, confirmations: 0, height: 0 })],
		})]);
		const t = item(await load(), "inv_0001");
		const inner = deep(t.blocks);
		const hint = inner.findIndex((x) => x.type === "context" && x.text === "Find each payment in your wallet app's transaction history by its Transaction ID.");
		expect(hint).toBeGreaterThan(-1);
		expect(inner[hint + 1].type).toBe("code");
		expect(inner[hint + 1].code).toBe(
			[
				"Payment 1 of 3: 0.010000000000 XMR, 3 confirmations, counted",
				`Transaction ID: ${"aa".repeat(32)}`,
				"",
				"Payment 2 of 3: 0.080000000000 XMR, 3 confirmations, not counted: time-locked until block 3000100",
				`Transaction ID: ${"bb".repeat(32)}`,
				"",
				"Payment 3 of 3: 0.080000000000 XMR, 0 confirmations, not counted: flagged as a possible double spend",
				`Transaction ID: ${"cc".repeat(32)}`,
			].join("\n"),
		);
	});

	it("no payments: no Transaction ID label or hint, and a line that says so", async () => {
		await setup([invoice(1)]);
		const s = JSON.stringify(item(await load(), "inv_0001"));
		expect(s).not.toContain("Transaction ID");
		expect(s).toContain("No payment reported yet.");
	});

	it("more than 50 payments: the first 50 listed, then how many more", async () => {
		await setup([invoice(1, { status: "seen", transfers: Array.from({ length: 53 }, (_, i) => transfer({ txid: i.toString(16).padStart(64, "0"), amountAtomic: "1" })) })]);
		const code = deep(item(await load(), "inv_0001").blocks).find((x) => x.type === "code" && String(x.code).startsWith("Payment 1 of 53"))?.code as string;
		expect(code.match(/^Transaction ID: /gm)).toHaveLength(50);
		expect(code.endsWith("…and 3 more payments.")).toBe(true);
	});
});

describe("paging (10 a page, Wyatt 2026-10-09)", () => {
	it("Load more shows the next 10, Newest invoices goes back; a malformed cursor shows the newest", async () => {
		await setup(Array.from({ length: 23 }, (_, i) => invoice(i + 1)));
		let b = await load();
		expect(ids(b)).toEqual(Array.from({ length: 10 }, (_, i) => `inv_${String(23 - i).padStart(4, "0")}`));
		expect(nav(b).map((e) => e.label)).toEqual(["Load more"]);
		const more = nav(b)[0];
		expect(more).toMatchObject({ type: "button", action_id: "invoices_page" });
		b = (await act(more.value, "invoices_page")).blocks as B[];
		expect(ids(b)[0]).toBe("inv_0013");
		expect(nav(b).map((e) => e.label)).toEqual(["Newest invoices", "Load more"]);
		b = (await act(nav(b)[1].value, "invoices_page")).blocks as B[];
		expect(ids(b)).toEqual(["inv_0003", "inv_0002", "inv_0001"]);
		expect(nav(b).map((e) => e.label)).toEqual(["Newest invoices"]);
		expect(ids((await act(undefined, "invoices_newest")).blocks as B[])[0]).toBe("inv_0023");
		expect(ids((await act({ cursor: 42 }, "invoices_page")).blocks as B[])[0]).toBe("inv_0023");
	});

	it("10 or fewer: no paging buttons", async () => {
		await setup(Array.from({ length: 10 }, (_, i) => invoice(i + 1)));
		expect(nav(await load())).toEqual([]);
	});
});

describe("the Actions menu", () => {
	it("offers only what fits the state, with no Details item (the details are already open)", async () => {
		await setup([
			invoice(1),
			invoice(2, { status: "review", reviewReason: "late", transfers: [transfer()] }),
			invoice(3, { status: "settled", settledAt: T0, transfers: [transfer()] }),
			invoice(4, { status: "expired" }),
			invoice(5, { required: MAX_REQUIRED }),
			invoice(6, { status: "settled", settledAt: T0, adminFinal: true, transfers: [transfer()] }),
		]);
		const b = await load();
		expect(menu(item(b, "inv_0001"))).toMatchObject({ type: "menu", action_id: "invoice_action", label: "Actions" });
		expect(menu(item(b, "inv_0001"))?.items.map((i: B) => i.label)).toEqual(["Mark settled", "Expire", `Raise confirmations to ${MAX_REQUIRED}`]);
		expect(menuValues(item(b, "inv_0001"))).toEqual(["settle:inv_0001", "expire:inv_0001", "raise:inv_0001"]);
		expect(menuValues(item(b, "inv_0002"))).toEqual(["settle:inv_0002", "expire:inv_0002"]);
		expect(menu(item(b, "inv_0003"))).toBeUndefined();
		expect(menuValues(item(b, "inv_0004"))).toEqual(["settle:inv_0004"]);
		expect(menuValues(item(b, "inv_0005"))).toEqual(["settle:inv_0005", "expire:inv_0005"]);
		expect(menu(item(b, "inv_0006"))).toBeUndefined();
		expect(JSON.stringify(b)).not.toContain("Details and txids");
	});

	it("after an action, the same invoice is open and the page stays where it was", async () => {
		await setup(Array.from({ length: 23 }, (_, i) => invoice(i + 1)));
		const page2 = (await act(nav(await load())[0].value, "invoices_page")).blocks as B[];
		const value = menuValues(item(page2, "inv_0012"))[1];
		expect(value.startsWith("expire:inv_0012|")).toBe(true);
		const r = await act(value);
		expect(r.toast).toMatchObject({ type: "success" });
		const b = r.blocks as B[];
		expect(ids(b)[0]).toBe("inv_0013");
		expect(item(b, "inv_0012")).toMatchObject({ block_id: "invoice_inv_0012_acted", default_open: true });
		expect(items(b).filter((x) => x.default_open)).toHaveLength(1);
		expect(item(b, "inv_0012").label.startsWith("Expired (by admin)")).toBe(true);
		// Coming back to that page later shows it closed again.
		const again = (await act(nav(await load())[0].value, "invoices_page")).blocks as B[];
		expect(item(again, "inv_0012")).toMatchObject({ block_id: "invoice_inv_0012", default_open: false });
	});

	it("a refused action opens the invoice too, so the admin sees why", async () => {
		const h = await setup([invoice(1)]);
		await load();
		await h.fixtures.plugin.storage("invoices", "inv_0001", invoice(1, { status: "settled", settledAt: Date.now(), transfers: [transfer()] }));
		const r = await act("settle:inv_0001");
		expect(r.toast).toMatchObject({ type: "error" });
		expect(item(r.blocks as B[], "inv_0001")).toMatchObject({ block_id: "invoice_inv_0001_acted", default_open: true });
	});
});

describe("actions", () => {
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
		for (const value of ["settle:inv_9999", "explode:inv_0001", "details:inv_0001", "settle", "settle:inv_0001|", 42, null, { id: "inv_0001" }]) {
			expect((await act(value)).toast).toMatchObject({ type: "error" });
		}
		expect(await stored("inv_0001")).toMatchObject({ status: "new" });
	});
});
