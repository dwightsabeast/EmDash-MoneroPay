// The admin page's review queue (phase 04 session 4d): what happened, and one recommended action per reason (Wyatt,
// 2026-10-08): late → Mark settled; underpaid, reorg and reversed → Expire; reversed also offers Mark settled behind a
// confirmation, for a payment the wallet app still shows.
import { afterEach, describe, expect, it } from "vitest";

import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";

import { type Invoice, type Transfer, newInvoice } from "../../src/core/invoice";
import { PUBLIC_KEYS } from "../sync/helpers";

let host: PluginRuntimeTestHost | undefined;
afterEach(async () => {
	await host?.dispose();
	host = undefined;
});

type B = Record<string, any>;
const H0 = 3_000_000;
const ADDR = (i: number) => `7${String(i).padStart(94, "G")}`;
const T0 = Date.now() - 3_600_000;

function invoice(n: number, over: Partial<Invoice> = {}): Invoice {
	const inv = newInvoice({ id: `inv_${String(n).padStart(4, "0")}`, token: `t${String(n).padStart(21, "0")}`, kind: "product", fiatMinor: 1200n, currency: "USD", rate: { minor: 15000n, source: "api.kraken.com" }, speed: "standard", subaddress: ADDR(n), addrIndex: n, now: T0 + n * 1000, chainHeight: H0 });
	return { ...inv, status: "review", ...over };
}
const transfer = (over: Partial<Transfer> = {}): Transfer => ({ txid: "ab".repeat(32), amountAtomic: "80000000000", confirmations: 4, height: H0 + 30, timestamp: 1_790_000_100, doubleSpendSeen: false, unlockTime: "0", seenAt: T0, poolTs: null, ...over });

async function setup(invoices: Invoice[] = []) {
	const h = await createPluginRuntimeTestHost();
	host = h;
	await h.fixtures.plugin.setting("bridgePublicKey", PUBLIC_KEYS.test1);
	await h.fixtures.plugin.kv("state:bridge", { height: H0 + 40, lastSyncAt: Date.now() - 30_000, version: 1, outdated: false });
	await h.fixtures.plugin.storage("pool", "9999", { addrIndex: 9999, address: ADDR(9999), status: "free" });
	await h.http.respond("https://api.kraken.com/0/public/Ticker?pair=XMRUSD", new Response(JSON.stringify({ error: [], result: { XXMRZUSD: { c: ["150.00", "1.0"] } } })));
	for (const inv of invoices) await h.fixtures.plugin.storage("invoices", inv.id, inv);
	return h;
}

const load = async () => (await (host as PluginRuntimeTestHost).admin.loadPage("/payments")).blocks as B[];
/** The review queue's blocks: from its header to the next divider. */
function queue(blocks: B[]): B[] {
	const start = blocks.findIndex((b) => b.type === "header" && b.text === "Review queue");
	expect(start).toBeGreaterThan(-1);
	const end = blocks.findIndex((b, i) => i > start && b.type === "divider");
	return blocks.slice(start + 1, end === -1 ? undefined : end);
}
const item = (blocks: B[], id: string) => queue(blocks).find((b) => b.type === "accordion" && b.block_id === `review_${id}`) as B;
const buttons = (it: B) => it.blocks.find((b: B) => b.type === "actions")?.elements as B[];
const text = (v: unknown) => JSON.stringify(v);

describe("review queue", () => {
	it("nothing in review: says so", async () => {
		await setup();
		expect(text(queue(await load()))).toContain("Nothing needs a decision.");
	});

	it("late: what happened, and Mark settled as the one recommended action", async () => {
		await setup([invoice(1, { reviewReason: "late", transfers: [transfer()] })]);
		const it = item(await load(), "inv_0001");
		expect(it).toMatchObject({ label: "Late payment: inv_0001 (12.00 USD)", default_open: true });
		expect(text(it)).toContain("Paid in full (0.080000000000 XMR), but mined after the invoice's deadline. The money is in your wallet.");
		expect(text(it)).toContain("Recommended: mark it settled and fulfil the order.");
		expect(buttons(it)).toEqual([{ type: "button", action_id: "invoice_action", label: "Mark settled", style: "primary", value: "settle:inv_0001" }]);
	});

	it("underpaid: how much arrived, the refund address as plain text, Expire recommended", async () => {
		await setup([invoice(2, { reviewReason: "underpaid", buyer: { refundAddress: ADDR(77) }, transfers: [transfer({ amountAtomic: "60000000000", confirmations: 7 })] })]);
		const it = item(await load(), "inv_0002");
		expect(it.label).toBe("Underpaid: inv_0002 (12.00 USD)");
		expect(text(it)).toContain("0.060000000000 of 0.080000000000 XMR arrived (75%) by the deadline, 7 confirmations.");
		expect(text(it)).toContain("Recommended: expire it, don't fulfil the order, and refund the buyer from your wallet app. To accept the smaller amount instead, use Mark settled in the invoice's menu below.");
		expect(it.blocks.find((b: B) => b.type === "fields")?.fields).toContainEqual({ label: "Refund address", value: ADDR(77) });
		expect(buttons(it)).toEqual([{ type: "button", action_id: "invoice_action", label: "Expire", style: "primary", value: "expire:inv_0002" }]);
	});

	it("reorg: Expire recommended", async () => {
		await setup([invoice(3, { reviewReason: "reorg", transfers: [transfer({ confirmations: 0, height: 0 })] })]);
		const it = item(await load(), "inv_0003");
		expect(it.label).toBe("Payment not re-mined after a reorg: inv_0003 (12.00 USD)");
		expect(text(it)).toContain("A chain reorganisation knocked the payment out of its block, and it wasn't mined again within 5 blocks.");
		expect(buttons(it)).toEqual([{ type: "button", action_id: "invoice_action", label: "Expire", style: "primary", value: "expire:inv_0003" }]);
	});

	it("reversed: Expire recommended, and Mark settled behind a confirmation for a payment the wallet app still shows", async () => {
		await setup([invoice(4, { reviewReason: "reversed", settledAt: T0 })]);
		const it = item(await load(), "inv_0004");
		expect(it.label).toBe("Settled payment gone: inv_0004 (12.00 USD)");
		expect(text(it)).toContain("This invoice was settled, but the wallet host no longer reports its payment (double-spent, or removed in a reorg).");
		expect(text(it)).toContain("If your wallet app still shows this payment, mark it settled instead: a reinstalled wallet host can report a payment gone by mistake.");
		expect(buttons(it)).toEqual([
			{ type: "button", action_id: "invoice_action", label: "Expire", style: "primary", value: "expire:inv_0004" },
			{
				type: "button", action_id: "invoice_action", label: "Mark settled", style: "secondary", value: "settle:inv_0004",
				confirm: { title: "Mark this invoice settled?", text: "Only if your wallet app shows the payment. The decision is final.", confirm: "Mark settled", deny: "Cancel" },
			},
		]);
	});

	it("the recommended action applies with one click and the item leaves the queue", async () => {
		const h = await setup([invoice(1, { reviewReason: "late", transfers: [transfer()] }), invoice(2, { reviewReason: "underpaid", transfers: [transfer({ amountAtomic: "1" })] })]);
		const r = await h.admin.act("/payments", "invoice_action", { value: "settle:inv_0001" });
		expect(r.toast).toMatchObject({ type: "success" });
		expect(item(r.blocks as B[], "inv_0001")).toBeUndefined();
		expect(item(r.blocks as B[], "inv_0002")).toBeDefined();
		expect(await h.inspect.storage.get("invoices", "inv_0001")).toMatchObject({ status: "settled", adminFinal: true });
	});

	it("a review item that changed since the page loaded is refused", async () => {
		const h = await setup([invoice(1, { reviewReason: "late", transfers: [transfer()] })]);
		await load();
		await h.fixtures.plugin.storage("invoices", "inv_0001", invoice(1, { status: "expired", adminFinal: true, transfers: [transfer()] }));
		const r = await h.admin.act("/payments", "invoice_action", { value: "settle:inv_0001" });
		expect(r.toast).toEqual({ type: "error", message: "This invoice changed since the page loaded (it's now expired (by admin)). Nothing was changed." });
	});

	it("tips in review are listed too (their table comes with phase 07)", async () => {
		await setup([{ ...invoice(5, { reviewReason: "late", transfers: [transfer({ amountAtomic: "200000000" })] }), kind: "tip", fiat: null, expectedAtomic: null, minAtomic: "100000000" }]);
		const it = item(await load(), "inv_0005");
		expect(it.label).toBe("Late payment: inv_0005 (tip)");
		expect(text(it)).toContain("0.000200000000 XMR");
	});

	it("at most 20 items, oldest deadline first, with how many more wait", async () => {
		await setup(Array.from({ length: 23 }, (_, i) => invoice(i + 1, { reviewReason: "late", transfers: [transfer()] })));
		const q = queue(await load());
		const items = q.filter((b) => b.type === "accordion");
		expect(items).toHaveLength(20);
		expect(items[0].block_id).toBe("review_inv_0001");
		expect(text(q)).toContain("3 more wait after these.");
		expect(items.slice(1).every((b) => b.default_open === false)).toBe(true);
	});
});
