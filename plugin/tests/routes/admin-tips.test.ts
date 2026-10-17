// The admin page's Tips view (phase 07, session 7b): totals per entry over settled visitor tips (counted payments only),
// the newest tips with their notes shown as literal text, a bounded scan, and notes gone after the 30-day purge. Admin
// test tips (no `via`) never count.
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
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 14, 12); // Oct 14, 12:00 UTC

const transfer = (amountAtomic: string, over: Partial<Transfer> = {}): Transfer => ({ txid: `${amountAtomic}`.padStart(64, "a"), amountAtomic, confirmations: 12, height: H0 + 1, timestamp: 1_790_000_000, doubleSpendSeen: false, unlockTime: "0", seenAt: T0, poolTs: null, ...over });

function tip(n: number, over: Partial<Invoice> & { entry?: { id: string; title: string } } = {}): Invoice {
	const { entry, ...rest } = over;
	const inv = newInvoice({
		id: `inv_t${n}`, token: `t${String(n).padStart(21, "0")}`, kind: "tip", fiatMinor: null, currency: "USD", rate: null, speed: "standard",
		subaddress: `7${String(n).padStart(94, "T")}`, addrIndex: n, now: T0 + n * 60_000, chainHeight: H0,
		...(entry ? { contentRef: { collection: "posts", id: entry.id }, uriDescription: `Tip: ${entry.title}` } : { uriDescription: "Tip" }),
	});
	return { ...inv, via: "checkout", ...rest };
}
const settled = (n: number, amount: string, over: Partial<Invoice> & { entry?: { id: string; title: string } } = {}) =>
	tip(n, { status: "settled", settledAt: T0 + n * 60_000 + 600_000, finalAt: T0 + n * 60_000 + 600_000, transfers: [transfer(amount)], ...over });

const HELLO = { id: "01HELLO", title: "Hello & welcome" };
const GUIDE = { id: "01GUIDE", title: "A long guide" };

async function setup(invoices: Invoice[] = []) {
	const h = await createPluginRuntimeTestHost();
	host = h;
	await h.fixtures.plugin.setting("bridgePublicKey", PUBLIC_KEYS.test1);
	await h.fixtures.plugin.kv("state:bridge", { height: H0 + 40, lastSyncAt: Date.now() - 30_000, version: 1, outdated: false });
	await h.fixtures.plugin.kv("state:setupDone", true);
	await h.http.respond("https://api.kraken.com/0/public/Ticker?pair=XMRUSD", new Response(JSON.stringify({ error: [], result: { XXMRZUSD: { c: ["150.00", "1.0"] } } })));
	for (let i = 0; i < invoices.length; i += 100) await Promise.all(invoices.slice(i, i + 100).map((inv) => h.fixtures.plugin.storage("invoices", inv.id, inv)));
	return h;
}

const load = async () => (await (host as PluginRuntimeTestHost).admin.loadPage("/payments")).blocks as B[];
/** The blocks from the Tips header to the next header. */
function tipsSection(blocks: B[]): B[] {
	const start = blocks.findIndex((b) => b.type === "header" && b.text === "Tips");
	expect(start).toBeGreaterThan(-1);
	const end = blocks.findIndex((b, i) => i > start && b.type === "header");
	return blocks.slice(start, end === -1 ? undefined : end);
}
const text = (v: unknown) => JSON.stringify(v);
const nodes = (v: unknown): number => (Array.isArray(v) ? 1 + v.reduce((a: number, x) => a + nodes(x), 0) : v && typeof v === "object" ? 1 + Object.values(v).reduce((a: number, x) => a + nodes(x), 0) : 1);

describe("Tips view", () => {
	it("no visitor tips yet: says so; an admin test tip doesn't count", async () => {
		const testTip = { ...settled(1, "500000000"), via: undefined };
		await setup([testTip]);
		const s = tipsSection(await load());
		expect(s).toContainEqual({ type: "context", text: "No tips yet. When visitors tip, the totals and their notes show here." });
		expect(text(s)).not.toContain("0.0005");
	});

	it("totals: settled visitor tips only, counted payments only, grouped by entry with the title stored at tip time", async () => {
		await setup([
			settled(1, "1000000000", { entry: HELLO }), // 0.001
			settled(2, "2500000000", { entry: HELLO }), // 0.0025
			settled(3, "500000000", { entry: GUIDE }), // 0.0005
			settled(4, "300000000"), // whole site: 0.0003
			// A settled tip whose extra transfer is time-locked: only the counted 0.0002 adds up.
			settled(5, "200000000", { entry: GUIDE, transfers: [transfer("200000000"), transfer("9000000000", { txid: "f".repeat(64), unlockTime: "3000100" })] }),
			tip(6, { entry: HELLO, status: "confirming", transfers: [transfer("7000000000", { confirmations: 1 })] }), // not settled yet
			tip(7, { entry: HELLO, status: "expired" }),
			{ ...settled(8, "8000000000", { entry: HELLO }), via: undefined }, // an admin test tip
		]);
		const s = tipsSection(await load());
		expect(s).toContainEqual({ type: "fields", fields: [{ label: "Received", value: "0.0045 XMR" }, { label: "Tips", value: "5 settled" }] });
		const byEntry = s.find((b) => b.type === "fields" && b.block_id === "tips_by_entry");
		expect(byEntry?.fields).toEqual([
			{ label: "Hello & welcome", value: "2 tips, 0.0035 XMR" },
			{ label: "A long guide", value: "2 tips, 0.0007 XMR" },
			{ label: "Whole site", value: "1 tip, 0.0003 XMR" },
		]);
	});

	it("the newest tips, with status, amount and entry; each note as literal text, whatever it contains", async () => {
		const notes = ["see https://evil.test/x?y=1 and www.example.com", "**bold** _it_ [link](https://e.test) `code`", "<script>alert(1)</script><b>hi</b> &amp;", '{"type":"button","action_id":"x"} | <@U123> <!channel>'];
		await setup(notes.map((note, i) => settled(i + 1, "100000000", { entry: HELLO, buyer: { note } })));
		const s = tipsSection(await load());
		for (const note of notes) expect(s).toContainEqual({ type: "context", text: `Note: ${note}` });
		// Newest first: tip 4's note comes before tip 1's.
		const order = s.filter((b) => b.type === "context" && String(b.text).startsWith("Note: ")).map((b) => b.text);
		expect(order[0]).toBe(`Note: ${notes[3]}`);
		expect(s).toContainEqual({ type: "section", text: "Oct 14, 12:04 UTC: 0.0001 XMR to Hello & welcome. Settled.", accessory: { type: "link", label: "Open entry", target: { kind: "content", collection: "posts", id: HELLO.id } } });
	});

	it("only the 10 newest are listed; open and expired ones say so", async () => {
		await setup([
			...Array.from({ length: 11 }, (_, i) => settled(i + 1, "100000000")),
			tip(20, { status: "new" }),
			tip(21, { status: "expired" }),
		]);
		const s = tipsSection(await load());
		const items = s.filter((b) => b.type === "section" && / UTC: /.test(String(b.text)));
		expect(items).toHaveLength(10);
		expect(items[0].text).toBe("Oct 14, 12:21 UTC: any amount to the whole site. Expired, nothing received.");
		expect(items[1].text).toBe("Oct 14, 12:20 UTC: any amount to the whole site. Waiting for payment.");
	});

	it("the scan reads the newest 1,000 visitor tips and says so beyond", { timeout: 60_000 }, async () => {
		await setup(Array.from({ length: 1_001 }, (_, i) => settled(i + 1, "100000000")));
		const s = tipsSection(await load());
		expect(s).toContainEqual({ type: "context", text: "Totals cover the newest 1,000 tips." });
		expect(s).toContainEqual({ type: "fields", fields: [{ label: "Received", value: "0.1 XMR" }, { label: "Tips", value: "1,000 settled" }] });
	});

	it("notes are gone after the 30-day purge, and the tip still counts", async () => {
		const old = settled(1, "100000000", { entry: HELLO, buyer: { note: "thanks!" }, finalAt: Date.now() - 31 * DAY, expiresAt: Date.now() - 31 * DAY });
		const h = await setup([old]);
		expect(text(tipsSection(await load()))).toContain("Note: thanks!");
		await (h as any).transport.invokeHook("cron", { name: "housekeeping", scheduledAt: new Date().toISOString() });
		const s = tipsSection(await load());
		expect(text(s)).not.toContain("thanks!");
		expect(s).toContainEqual({ type: "fields", fields: [{ label: "Received", value: "0.0001 XMR" }, { label: "Tips", value: "1 settled" }] });
	});

	it("worst case stays inside Block Kit's limits: 1,000 tips over 30 entries, every one with a 140-character note", { timeout: 60_000 }, async () => {
		const note = "n".repeat(140);
		await setup(Array.from({ length: 1_000 }, (_, i) => settled(i + 1, "123456789012", { entry: { id: `01E${String(i % 30).padStart(4, "0")}`, title: `Entry ${"x".repeat(90)} ${i % 30}` }, buyer: { note } })));
		const page = await (host as PluginRuntimeTestHost).admin.loadPage("/payments");
		const byEntry = tipsSection(page.blocks as B[]).find((b) => b.block_id === "tips_by_entry");
		expect(byEntry?.fields).toHaveLength(11); // the top 10, then "20 more entries"
		// 1,000 tips over 30 entries: the first 10 get 34 each, the other 20 get 33 each (660 tips, 660 x 0.123456789012).
		expect(byEntry?.fields.at(-1)).toEqual({ label: "Other entries", value: "20 more entries, 660 tips, 81.48148074792 XMR" });
		expect(nodes(page)).toBeLessThan(2000);
		expect(JSON.stringify(page).length).toBeLessThan(256 * 1024);
	});
});
