// "Needs a decision" (phase 04 sessions 4d and the click-through changes, decisions.md 2026-10-08 and 2026-10-09): one
// banner per invoice in review, red where the money may be gone (reversed, reorg) and yellow where it arrived (late,
// underpaid), each with a closed "Details and actions" toggle holding what happened, the recommendation and the buttons.
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
// 2026-10-06 12:00 UTC, so the created date reads "Oct 6".
const T0 = Date.UTC(2026, 9, 6, 12);

function invoice(n: number, over: Partial<Invoice> = {}): Invoice {
	const inv = newInvoice({ id: `inv_${String(n).padStart(4, "0")}`, token: `t${String(n).padStart(21, "0")}`, kind: "product", fiatMinor: 100n, currency: "USD", rate: { minor: 56000n, source: "api.kraken.com" }, speed: "standard", subaddress: ADDR(n), addrIndex: n, now: T0 + n * 1000, chainHeight: H0, productRef: { collection: "products", id: `prod_${n}` } });
	return { ...inv, status: "review", ...over };
}
// 1.00 USD at 560.00 USD/XMR: 1785714286 atomic expected (ceil).
const EXPECTED = 1785714286n;
const transfer = (over: Partial<Transfer> = {}): Transfer => ({ txid: "ab".repeat(32), amountAtomic: String(EXPECTED), confirmations: 94, height: H0 + 30, timestamp: 1_790_000_100, doubleSpendSeen: false, unlockTime: "0", seenAt: T0, poolTs: null, ...over });

async function setup(invoices: Invoice[] = []) {
	const h = await createPluginRuntimeTestHost();
	host = h;
	await h.fixtures.plugin.setting("bridgePublicKey", PUBLIC_KEYS.test1);
	await h.fixtures.plugin.kv("state:bridge", { height: H0 + 40, lastSyncAt: Date.now() - 30_000, version: 1, outdated: false });
	await h.fixtures.plugin.kv("state:setupDone", true);
	await h.fixtures.plugin.storage("pool", "9999", { addrIndex: 9999, address: ADDR(9999), status: "free" });
	await h.http.respond("https://api.kraken.com/0/public/Ticker?pair=XMRUSD", new Response(JSON.stringify({ error: [], result: { XXMRZUSD: { c: ["150.00", "1.0"] } } })));
	for (let i = 0; i < invoices.length; i += 50) await Promise.all(invoices.slice(i, i + 50).map((inv) => h.fixtures.plugin.storage("invoices", inv.id, inv)));
	return h;
}

const load = async () => (await (host as PluginRuntimeTestHost).admin.loadPage("/payments")).blocks as B[];
const banner = (blocks: B[], id: string) => blocks.find((b) => b.type === "banner" && b.block_id === `review_${id}`) as B | undefined;
const toggle = (blocks: B[], id: string) => blocks.find((b) => b.type === "accordion" && b.block_id === `review_${id}_details`) as B | undefined;
const actions = (t: B) => t.blocks.find((b: B) => b.type === "actions")?.elements as B[];
const fieldsOf = (t: B) => t.blocks.find((b: B) => b.type === "fields")?.fields as Array<{ label: string; value: string }>;
const field = (t: B, label: string) => fieldsOf(t).find((f) => f.label === label)?.value;
const text = (v: unknown) => JSON.stringify(v);
const reviewBanners = (blocks: B[]) => blocks.filter((b) => b.type === "banner" && String(b.block_id).startsWith("review_"));
const OPEN_PRODUCT = (n: number) => ({ type: "link", label: "Open product", target: { kind: "content", collection: "products", id: `prod_${n}` } });

describe("Needs a decision", () => {
	it("nothing in review: the group is left out", async () => {
		await setup();
		const b = await load();
		expect(b.some((x) => x.type === "header" && String(x.text).startsWith("Needs a decision"))).toBe(false);
		expect(reviewBanners(b)).toEqual([]);
	});

	it("each item: a banner with the reason and a summary, the invoice, amount and created date; a closed toggle under it", async () => {
		await setup([invoice(1, { reviewReason: "underpaid", transfers: [transfer({ amountAtomic: "1060000000" })] })]);
		const b = await load();
		expect(b.find((x) => x.type === "header" && String(x.text).startsWith("Needs a decision"))?.text).toBe("Needs a decision (1)");
		expect(banner(b, "inv_0001")).toEqual({ type: "banner", block_id: "review_inv_0001", variant: "alert", title: "Underpaid · 59% received", description: "inv_0001 · 1.00 USD · created Oct 6" });
		const i = b.findIndex((x) => x.block_id === "review_inv_0001");
		expect(b[i + 1]).toMatchObject({ type: "accordion", block_id: "review_inv_0001_details", label: "Details and actions", default_open: false });
	});

	it("variants: red for reversed and reorg, yellow for late and underpaid; red first, then the oldest deadline", async () => {
		await setup([
			invoice(1, { reviewReason: "late", transfers: [transfer()] }),
			invoice(2, { reviewReason: "underpaid", transfers: [transfer({ amountAtomic: "1" })] }),
			invoice(3, { reviewReason: "reorg", transfers: [transfer({ confirmations: 0, height: 0 })] }),
			invoice(4, { reviewReason: "reversed", settledAt: T0 }),
		]);
		const b = await load();
		expect(reviewBanners(b).map((x) => [x.block_id, x.variant])).toEqual([
			["review_inv_0003", "error"], ["review_inv_0004", "error"], ["review_inv_0001", "alert"], ["review_inv_0002", "alert"],
		]);
		expect(banner(b, "inv_0001")?.title).toBe("Late payment · paid in full");
		expect(banner(b, "inv_0003")?.title).toBe("Payment not re-mined after a reorg");
		expect(banner(b, "inv_0004")?.title).toBe("Settled payment gone");
	});

	it("late, paid in full: Mark settled recommended, Open product beside it", async () => {
		await setup([invoice(1, { reviewReason: "late", transfers: [transfer()] })]);
		const t = toggle(await load(), "inv_0001") as B;
		expect(text(t)).toContain("Paid in full (0.001785714286 XMR), but mined after the invoice's deadline. The money is in your wallet.");
		expect(text(t)).toContain("Recommended: mark it settled and fulfil the order.");
		expect(actions(t)).toEqual([{ type: "button", action_id: "invoice_action", label: "Mark settled", style: "primary", value: "settle:inv_0001" }, OPEN_PRODUCT(1)]);
		expect(field(t, "Confirmations")).toBe("94 (needs 2)");
	});

	it("late but short of the price: treated like underpaid, Expire recommended (Wyatt, Q2)", async () => {
		await setup([invoice(1, { reviewReason: "late", transfers: [transfer({ amountAtomic: "892857143", height: H0 + 2 }), transfer({ txid: "cd".repeat(32), amountAtomic: "357142858" })] })]);
		const b = await load();
		expect(banner(b, "inv_0001")).toMatchObject({ variant: "alert", title: "Late payment · 70% received" });
		const t = toggle(b, "inv_0001") as B;
		expect(text(t)).toContain("0.001250000001 of 0.001785714286 XMR arrived (70%), part of it after the invoice's deadline.");
		expect(text(t)).toContain("Recommended: expire it, don't fulfil the order, and refund the buyer from your wallet app. To accept it instead, use Mark settled in its row under All invoices below.");
		expect(actions(t)[0]).toEqual({ type: "button", action_id: "invoice_action", label: "Expire", style: "primary", value: "expire:inv_0001" });
	});

	it("underpaid: how much arrived, the refund address as plain text, Expire recommended, wording that points at All invoices", async () => {
		await setup([invoice(2, { reviewReason: "underpaid", buyer: { refundAddress: ADDR(77) }, transfers: [transfer({ amountAtomic: "1339285715", confirmations: 7 })] })]);
		const t = toggle(await load(), "inv_0002") as B;
		expect(text(t)).toContain("0.001339285715 of 0.001785714286 XMR arrived (75%) by the deadline, 7 confirmations.");
		expect(text(t)).toContain("Recommended: expire it, don't fulfil the order, and refund the buyer from your wallet app. To accept the smaller amount instead, use Mark settled in its row under All invoices below.");
		expect(field(t, "Refund address")).toBe(ADDR(77));
		expect(actions(t)).toEqual([{ type: "button", action_id: "invoice_action", label: "Expire", style: "primary", value: "expire:inv_0002" }, OPEN_PRODUCT(2)]);
	});

	it("reorg: Expire recommended; Confirmations and Received say the payment isn't in a block now (change 7)", async () => {
		await setup([invoice(3, { reviewReason: "reorg", transfers: [transfer({ confirmations: 0, height: 0 })] })]);
		const t = toggle(await load(), "inv_0003") as B;
		expect(text(t)).toContain("A chain reorganisation knocked the payment out of its block, and it wasn't mined again within 5 blocks.");
		expect(field(t, "Confirmations")).toBe("Not mined again (needed 2)");
		expect(field(t, "Received")).toBe("0.001785714286 XMR, not in a block now");
		expect(actions(t)[0]).toMatchObject({ label: "Expire", style: "primary", value: "expire:inv_0003" });
	});

	it("reversed: Expire recommended, Mark settled behind a confirmation; 'No longer reported' and '0 XMR now' (change 7)", async () => {
		await setup([invoice(4, { reviewReason: "reversed", settledAt: T0 })]);
		const t = toggle(await load(), "inv_0004") as B;
		expect(text(t)).toContain("This invoice was settled, but the wallet host no longer reports its payment (double-spent, or removed in a reorg).");
		expect(text(t)).toContain("If your wallet app still shows this payment, mark it settled instead: a reinstalled wallet host can report a payment gone by mistake.");
		expect(field(t, "Confirmations")).toBe("No longer reported (needed 2)");
		expect(field(t, "Received")).toBe("0 XMR now");
		expect(actions(t)).toEqual([
			{ type: "button", action_id: "invoice_action", label: "Expire", style: "primary", value: "expire:inv_0004" },
			{
				type: "button", action_id: "invoice_action", label: "Mark settled", style: "secondary", value: "settle:inv_0004",
				confirm: { title: "Mark this invoice settled?", text: "Only if your wallet app shows the payment. The decision is final.", confirm: "Mark settled", deny: "Cancel" },
			},
			OPEN_PRODUCT(4),
		]);
	});

	it("reversed with the settling transfer still held, now flagged: Received says what was reported", async () => {
		await setup([invoice(4, { reviewReason: "reversed", settledAt: T0, transfers: [transfer({ doubleSpendSeen: true })] })]);
		const t = toggle(await load(), "inv_0004") as B;
		expect(field(t, "Received")).toBe("0 XMR now (0.001785714286 XMR was reported, now not counted: flagged as a possible double spend)");
	});

	it("the recommended action applies from inside the toggle, and the item leaves the group", async () => {
		const h = await setup([invoice(1, { reviewReason: "late", transfers: [transfer()] }), invoice(2, { reviewReason: "underpaid", transfers: [transfer({ amountAtomic: "1" })] })]);
		const r = await h.admin.act("/payments", "invoice_action", { value: "settle:inv_0001" });
		expect(r.toast).toMatchObject({ type: "success" });
		expect(banner(r.blocks as B[], "inv_0001")).toBeUndefined();
		expect(banner(r.blocks as B[], "inv_0002")).toBeDefined();
		expect((r.blocks as B[]).find((x) => x.type === "header" && String(x.text).startsWith("Needs a decision"))?.text).toBe("Needs a decision (1)");
		expect(await h.inspect.storage.get("invoices", "inv_0001")).toMatchObject({ status: "settled", adminFinal: true });
	});

	it("a review item that changed since the page loaded is refused", async () => {
		const h = await setup([invoice(1, { reviewReason: "late", transfers: [transfer()] })]);
		await load();
		await h.fixtures.plugin.storage("invoices", "inv_0001", invoice(1, { status: "expired", adminFinal: true, transfers: [transfer()] }));
		const r = await h.admin.act("/payments", "invoice_action", { value: "settle:inv_0001" });
		expect(r.toast).toEqual({ type: "error", message: "This invoice changed since the page loaded (it's now expired (by admin)). Nothing was changed." });
	});

	it("tips in review are listed too, with no product link and no pointer to the products table", async () => {
		await setup([{ ...invoice(5, { reviewReason: "late", transfers: [transfer({ amountAtomic: "200000000" })] }), kind: "tip", fiat: null, expectedAtomic: null, minAtomic: "100000000", productRef: undefined }]);
		const b = await load();
		expect(banner(b, "inv_0005")).toMatchObject({ title: "Late payment · paid in full", description: "inv_0005 · tip · created Oct 6" });
		const t = toggle(b, "inv_0005") as B;
		expect(text(t)).toContain("0.000200000000 XMR");
		expect(actions(t).some((e) => e.type === "link")).toBe(false);
	});

	it("12 a page: Show the next 12 moves on, Back returns, and past item 60 the rest are in All invoices (Wyatt, 2026-10-09)", { timeout: 30_000 }, async () => {
		const h = await setup(Array.from({ length: 70 }, (_, i) => invoice(i + 1, { reviewReason: "late", transfers: [transfer()] })));
		const nav = (blocks: B[]) => (blocks.find((x) => x.type === "actions" && x.block_id === "review_nav")?.elements ?? []) as B[];
		const ids = (blocks: B[]) => reviewBanners(blocks).map((x) => x.block_id);
		let b = await load();
		expect(ids(b)).toEqual(Array.from({ length: 12 }, (_, i) => `review_inv_${String(i + 1).padStart(4, "0")}`));
		expect(text(b)).toContain("Showing 1–12 of 70.");
		expect(nav(b)).toEqual([{ type: "button", action_id: "review_page", label: "Show the next 12 (58 more)", value: { start: 12 } }]);
		b = (await h.admin.act("/payments", "review_page", { value: { start: 12 } })).blocks as B[];
		expect(ids(b)[0]).toBe("review_inv_0013");
		expect(text(b)).toContain("Showing 13–24 of 70.");
		expect(nav(b).map((e) => [e.label, e.value])).toEqual([["Back to the first 12", { start: 0 }], ["Show the next 12 (46 more)", { start: 24 }]]);
		b = (await h.admin.act("/payments", "review_page", { value: { start: 48 } })).blocks as B[];
		expect(ids(b)).toHaveLength(12);
		expect(ids(b)[11]).toBe("review_inv_0060");
		expect(nav(b).map((e) => e.label)).toEqual(["Back to the first 12"]);
		expect(text(b)).toContain("10 more are in All invoices below, marked Needs decision.");
		// Values off the steps or out of range are clamped; anything else shows the first page.
		expect(ids((await h.admin.act("/payments", "review_page", { value: { start: 5000 } })).blocks as B[])[0]).toBe("review_inv_0049");
		expect(ids((await h.admin.act("/payments", "review_page", { value: { start: 13 } })).blocks as B[])[0]).toBe("review_inv_0013");
		expect(ids((await h.admin.act("/payments", "review_page", { value: "x" })).blocks as B[])[0]).toBe("review_inv_0001");
	});

	it("12 or fewer: no paging line or buttons", async () => {
		await setup(Array.from({ length: 12 }, (_, i) => invoice(i + 1, { reviewReason: "late", transfers: [transfer()] })));
		const b = await load();
		expect(reviewBanners(b)).toHaveLength(12);
		expect(text(b)).not.toContain("Showing 1–");
		expect(b.some((x) => x.block_id === "review_nav")).toBe(false);
	});
});

describe("limits", () => {
	// EmDash counts every value as a node (validateResponseBounds), strings and numbers included.
	const nodes = (v: unknown): number => (Array.isArray(v) ? 1 + v.reduce((a: number, x) => a + nodes(x), 0) : v && typeof v === "object" ? 1 + Object.values(v).reduce((a: number, x) => a + nodes(x), 0) : 1);

	it("the worst case: 300 reversed items with everything, a full table of open invoices, and an open Details panel with 32 transfers", { timeout: 30_000 }, async () => {
		const worst = (n: number) => invoice(n, { reviewReason: "reversed", settledAt: T0, buyer: { email: "someone.long.name@example.invalid", refundAddress: ADDR(5) } });
		const open = (n: number) => ({ ...invoice(n), status: "new" as const, createdAt: Date.now() - n });
		const many = invoice(1000, { status: "new", createdAt: Date.now(), transfers: Array.from({ length: 32 }, (_, i) => transfer({ txid: i.toString(16).padStart(64, "0"), amountAtomic: "1" })) });
		const h = await setup([...Array.from({ length: 300 }, (_, i) => worst(i + 1)), ...Array.from({ length: 25 }, (_, i) => open(2000 + i)), many]);
		const page = await h.admin.act("/payments", "invoice_action", { value: "details:inv_1000" });
		const blocks = page.blocks as B[];
		expect(reviewBanners(blocks)).toHaveLength(12);
		expect(blocks.find((x) => x.block_id === "invoice_details")).toBeDefined();
		expect(blocks.find((x) => x.type === "table")?.rows).toHaveLength(25);
		expect(nodes(page)).toBeLessThan(2000);
		expect(JSON.stringify(page).length).toBeLessThan(256 * 1024);
	});

	it("red first across the whole queue, not just the first page by deadline", { timeout: 30_000 }, async () => {
		// 150 yellow items with earlier deadlines, then 5 red ones.
		await setup([...Array.from({ length: 150 }, (_, i) => invoice(i + 1, { reviewReason: "late", transfers: [transfer()] })), ...Array.from({ length: 5 }, (_, i) => invoice(500 + i, { reviewReason: "reorg", transfers: [transfer({ confirmations: 0, height: 0 })] }))]);
		const banners = reviewBanners(await load());
		expect(banners.slice(0, 5).map((x) => x.variant)).toEqual(["error", "error", "error", "error", "error"]);
		expect(banners[5].variant).toBe("alert");
	});
});
