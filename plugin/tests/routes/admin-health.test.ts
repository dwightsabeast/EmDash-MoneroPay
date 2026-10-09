// The admin page's health panel and the dashboard widget (phase 04 session 4a), through the runtime host's admin
// helpers, which also validate every Block Kit response.
import { afterEach, describe, expect, it } from "vitest";

import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";

import { GAP_ALERT, UNPAID_RUN_ALERT } from "../../src/core/constants";
import { type Invoice, newInvoice } from "../../src/core/invoice";
import { PUBLIC_KEYS } from "../sync/helpers";

let host: PluginRuntimeTestHost | undefined;
afterEach(async () => {
	await host?.dispose();
	host = undefined;
});

type B = Record<string, any>;
const H0 = 3_000_000;
const KRAKEN = "https://api.kraken.com/0/public/Ticker?pair=XMRUSD";
const GECKO = "https://api.coingecko.com/api/v3/simple/price?ids=monero&vs_currencies=usd";
const krakenOk = () => new Response(JSON.stringify({ error: [], result: { XXMRZUSD: { c: ["150.00", "1.0"] } } }));
const ADDR = (i: number) => `7${String(i).padStart(94, "C")}`;

interface Setup {
	paired?: boolean;
	lastSyncAgo?: number | null;
	checks?: unknown;
	outdated?: boolean;
	free?: number;
	claimed?: number[];
	price?: boolean;
	paidTop?: number | null;
	clientIp?: boolean;
}

async function setup(o: Setup = {}) {
	const h = await createPluginRuntimeTestHost();
	host = h;
	if (o.paired !== false) await h.fixtures.plugin.setting("bridgePublicKey", PUBLIC_KEYS.test1);
	const ago = o.lastSyncAgo === undefined ? 30_000 : o.lastSyncAgo;
	if (ago !== null) {
		await h.fixtures.plugin.kv("state:bridge", { height: H0, lastSyncAt: Date.now() - ago, version: 1, outdated: o.outdated ?? false, ...(o.checks ? { checks: o.checks } : {}) });
	}
	for (let i = 1; i <= (o.free ?? 50); i++) await h.fixtures.plugin.storage("pool", String(1000 + i), { addrIndex: 1000 + i, address: ADDR(1000 + i), status: "free" });
	for (const i of o.claimed ?? []) await h.fixtures.plugin.storage("pool", String(i), { addrIndex: i, address: ADDR(i), status: "claimed", invoiceId: `inv_${i}` });
	if (o.paidTop !== undefined && o.paidTop !== null) await h.fixtures.plugin.kv("state:paidTop", o.paidTop);
	if (o.clientIp !== undefined) await h.fixtures.plugin.kv("state:clientIp", o.clientIp);
	if (o.price === false) {
		await h.http.respond(KRAKEN, new Response("down", { status: 502 }));
		await h.http.respond(GECKO, new Response("down", { status: 502 }));
	} else {
		await h.http.respond(KRAKEN, krakenOk());
	}
	return h;
}

const load = async () => (await (host as PluginRuntimeTestHost).admin.loadPage("/payments")).blocks as B[];
const widgetText = async () => JSON.stringify((await (host as PluginRuntimeTestHost).admin.loadWidget("xmr-status")).blocks);
const field = (blocks: B[], label: string) => blocks.find((b) => b.type === "fields" && b.block_id === "health")?.fields.find((f: B) => f.label === label)?.value as string | undefined;
const banners = (blocks: B[]) => blocks.filter((b) => b.type === "banner").map((b) => ({ variant: b.variant ?? "default", title: b.title as string, description: b.description as string }));
const titles = (blocks: B[]) => banners(blocks).map((b) => b.title);

function invoice(id: string, index: number, over: Partial<Invoice> = {}): Invoice {
	const inv = newInvoice({ id, token: id.padEnd(22, "x").slice(0, 22), kind: "product", fiatMinor: 1200n, currency: "USD", rate: { minor: 15000n, source: "t" }, speed: "standard", subaddress: ADDR(index), addrIndex: index, now: Date.now() - 3_600_000, chainHeight: H0 });
	return { ...inv, ...over };
}
const paidTransfer = { txid: "ab".repeat(32), amount: "80000000000", amountAtomic: "80000000000", confirmations: 12, height: H0 + 1, timestamp: 1_790_000_100, doubleSpendSeen: false, unlockTime: "0", seenAt: 1, poolTs: 1 };

describe("health panel", () => {
	it("a healthy site: one line per check, the addresses meter with its hint, no banners", async () => {
		await setup({ checks: { node: { state: "off" }, wallet: { state: "ok", detail: "wallet and node at block 3000000" } }, free: 48, claimed: [1, 2], paidTop: 2 });
		const b = await load();
		expect(field(b, "Wallet host")).toBe("Paired");
		expect(field(b, "Last sync")).toBe("less than a minute ago");
		expect(field(b, "Wallet height")).toBe("3000000, in step with its node");
		expect(field(b, "Price feed")).toBe("1 XMR = 150.00 USD (api.kraken.com)");
		expect(field(b, "Review items")).toBe("None");
		expect(field(b, "Unpaid checkouts in a row")).toBe("0");
		expect(field(b, "Remote-node cross-check")).toBe("Off (the wallet host uses your own node)");
		expect(field(b, "Unpaid addresses since the last payment")).toBe(`0 (warning at ${GAP_ALERT})`);
		expect(b.find((x) => x.type === "meter")).toEqual({ type: "meter", label: "Payment addresses ready", value: 48, max: 50, custom_value: "48 of 50" });
		expect(JSON.stringify(b)).toContain("Each payment gets its own address from your wallet. The wallet host adds more automatically.");
		expect(banners(b)).toEqual([]);
		expect(await widgetText()).toContain("Healthy: last sync less than a minute ago, 48 of 50 payment addresses ready.");
	});

	it("a fresh site: not paired, never synced, no addresses; setup, not red lines", async () => {
		await setup({ paired: false, lastSyncAgo: null, free: 0 });
		const b = await load();
		expect(field(b, "Wallet host")).toBe("Not paired");
		expect(field(b, "Last sync")).toBe("Never");
		expect(field(b, "Wallet height")).toBe("Unknown until the wallet host syncs");
		expect(b.find((x) => x.type === "meter")).toMatchObject({ value: 0, custom_value: "0 of 50" });
		expect(banners(b).filter((x) => x.variant === "error")).toEqual([]);
		expect(await widgetText()).toContain("Not set up: connect a wallet host on the Monero payments page.");
	});

	it("a silent wallet host: a red line that names the fix and says checkout is paused", async () => {
		await setup({ lastSyncAgo: 12 * 60_000 });
		const b = await load();
		expect(banners(b)).toContainEqual({ variant: "error", title: "Wallet host silent for 12 min", description: "Checkout is paused until it syncs again. On the wallet host, run: xmr-bridge status" });
		expect(field(b, "Last sync")).toBe("12 min ago");
		expect(await widgetText()).toContain("Wallet host silent for 12 min");
	});

	it("paired but never synced: an amber line", async () => {
		await setup({ lastSyncAgo: null });
		expect(banners(await load())).toContainEqual({ variant: "alert", title: "Wallet host paired but not syncing yet", description: "On the wallet host, run: xmr-bridge status" });
	});

	it("the wallet's height against its node: behind is red with the bridge's detail, unavailable amber, absent shows the height alone", async () => {
		await setup({ checks: { wallet: { state: "behind", detail: "the wallet is at block 2999000, its node at 3000000" } } });
		let b = await load();
		expect(field(b, "Wallet height")).toBe("3000000: the wallet is at block 2999000, its node at 3000000");
		expect(banners(b)).toContainEqual({ variant: "error", title: "The wallet is behind its node", description: "the wallet is at block 2999000, its node at 3000000. It catches up by itself after a restart or an outage; if this stays, run xmr-bridge status on the wallet host." });
		await host?.dispose();

		await setup({ checks: { wallet: { state: "unavailable", detail: "the node didn't answer" } } });
		b = await load();
		expect(field(b, "Wallet height")).toBe("3000000 (its node's height is unknown: the node didn't answer)");
		expect(banners(b)).toContainEqual({ variant: "alert", title: "The wallet host can't read its node's height", description: "the node didn't answer" });
		await host?.dispose();

		await setup();
		b = await load();
		expect(field(b, "Wallet height")).toBe("3000000");
		expect(banners(b)).toEqual([]);
	});

	it("the remote-node cross-check: mismatch red, unavailable amber, ok green, each with the bridge's detail", async () => {
		const mismatch = "the configured node's block at height 5 differs from node.example's: payments in it are held at 0 confirmations. Use your own node, or one you trust";
		await setup({ checks: { node: { state: "mismatch", detail: mismatch } } });
		let b = await load();
		expect(field(b, "Remote-node cross-check")).toBe("Mismatch");
		expect(banners(b)).toContainEqual({ variant: "error", title: "The wallet host's node disagrees with a second node", description: mismatch });
		await host?.dispose();

		await setup({ checks: { node: { state: "unavailable", detail: "no second node answered" } } });
		b = await load();
		expect(field(b, "Remote-node cross-check")).toBe("Unavailable");
		expect(banners(b)).toContainEqual({ variant: "alert", title: "Remote-node cross-check unavailable", description: "no second node answered" });
		await host?.dispose();

		await setup({ checks: { node: { state: "ok" } } });
		expect(field(await load(), "Remote-node cross-check")).toBe("OK");
	});

	it("no payment addresses ready: red", async () => {
		await setup({ free: 0 });
		expect(banners(await load())).toContainEqual({ variant: "error", title: "No payment addresses ready", description: "Checkout can't take payments until the wallet host adds more, which it does at its next sync. If this stays, run xmr-bridge status on the wallet host." });
	});

	it("the price feed: red when both price services fail", async () => {
		await setup({ price: false });
		const b = await load();
		expect(field(b, "Price feed")).toBe("Not answering");
		expect(banners(b)).toContainEqual({ variant: "error", title: "Price feed not answering", description: "Both price services failed just now, so checkout refuses new orders until one answers. It retries by itself; if this lasts, check the site's outbound network." });
	});

	it("review items: counted, amber, and in the widget", async () => {
		const h = await setup();
		for (const [id, reason] of [["inv_r1", "late"], ["inv_r2", "underpaid"]] as const) await h.fixtures.plugin.storage("invoices", id, invoice(id, id === "inv_r1" ? 3 : 4, { status: "review", reviewReason: reason }));
		const b = await load();
		expect(field(b, "Review items")).toBe("2 need a decision");
		expect(banners(b)).toContainEqual({ variant: "alert", title: "2 invoices need a decision", description: "Each one shows what happened and a recommended action in the review queue." });
		expect(await widgetText()).toContain("2 review items");
	});

	it(`a run of unpaid expired checkouts: amber at ${UNPAID_RUN_ALERT}, quiet below, broken by a paid one`, async () => {
		const h = await setup();
		const now = Date.now();
		// Newest first: UNPAID_RUN_ALERT - 1 unpaid, then one with a payment, then more unpaid.
		for (let i = 0; i < UNPAID_RUN_ALERT + 3; i++) {
			const paid = i === UNPAID_RUN_ALERT - 1;
			await h.fixtures.plugin.storage("invoices", `inv_e${i}`, invoice(`inv_e${i}`, 100 + i, { status: paid ? "review" : "expired", ...(paid ? { reviewReason: "late", transfers: [paidTransfer] } : {}), expiresAt: now - (i + 1) * 60_000 }));
		}
		let b = await load();
		expect(field(b, "Unpaid checkouts in a row")).toBe(String(UNPAID_RUN_ALERT - 1));
		expect(titles(b).some((t) => t.includes("expired unpaid"))).toBe(false);
		await h.fixtures.plugin.storage("invoices", "inv_new", invoice("inv_new", 200, { status: "expired", expiresAt: now - 1000 }));
		b = await load();
		expect(field(b, "Unpaid checkouts in a row")).toBe(String(UNPAID_RUN_ALERT));
		expect(banners(b)).toContainEqual({ variant: "alert", title: `The last ${UNPAID_RUN_ALERT} checkouts expired unpaid`, description: "Buyers may be stuck. Open your pay page and check that it shows the address and the amount, then try a small test payment." });
	});

	for (const gap of [GAP_ALERT - 1, GAP_ALERT, GAP_ALERT + 1]) {
		it(`the unpaid address gap at ${gap}: red from ${GAP_ALERT} (spec change 9)`, async () => {
			await setup({ claimed: [9 + gap], paidTop: 9 });
			const b = await load();
			expect(field(b, "Unpaid addresses since the last payment")).toBe(`${gap} (warning at ${GAP_ALERT})`);
			const line = banners(b).find((x) => x.title === "Your wallet app may miss payments");
			if (gap < GAP_ALERT) expect(line).toBeUndefined();
			else {
				expect(line).toEqual({
					variant: "error",
					title: "Your wallet app may miss payments",
					description: `${gap} payment addresses have gone unpaid since the last payment (address #9). Wallet apps look only about 200 addresses past the last paid one, so a payment to a later address can be missing from your wallet app's balance (Coffer still sees it). In your wallet app, create receiving addresses up to #${9 + gap}, then rescan the wallet.`,
				});
			}
		});
	}

	it("the highest paid index is worked out once from the invoices when it was never recorded", async () => {
		const h = await setup({ claimed: [3, 7, 40] });
		await h.fixtures.plugin.storage("invoices", "inv_p", invoice("inv_p", 7, { status: "settled", transfers: [paidTransfer] }));
		await h.fixtures.plugin.storage("invoices", "inv_q", invoice("inv_q", 40, { status: "expired", transfers: [{ ...paidTransfer, txid: "cd".repeat(32), unlockTime: "99" }] }));
		expect(field(await load(), "Unpaid addresses since the last payment")).toBe(`33 (warning at ${GAP_ALERT})`);
		expect(await h.inspect.kv.get("state:paidTop")).toBe(7);
	});

	it("spam limits: an information line (never red) when checkouts arrive without the visitor's IP", async () => {
		await setup({ clientIp: false });
		const b = await load();
		expect(JSON.stringify(b)).toContain("Per-visitor spam limits are off: this site doesn't pass visitors' IP addresses to plugins. The site-wide limit of 40 open invoices still applies.");
		expect(banners(b).filter((x) => x.variant !== "default")).toEqual([]);
		await host?.dispose();
		await setup({ clientIp: true });
		expect(JSON.stringify(await load())).not.toContain("Per-visitor spam limits are off");
	});

	it("an outdated wallet host: a plain banner with the update command", async () => {
		await setup({ outdated: true });
		expect(banners(await load())).toContainEqual({ variant: "default", title: "Wallet host update available", description: "On the wallet host, run: xmr-bridge update" });
	});

	it("the widget names the worst problem first, then the review count", async () => {
		const h = await setup({ lastSyncAgo: 12 * 60_000, free: 0 });
		await h.fixtures.plugin.storage("invoices", "inv_r", invoice("inv_r", 3, { status: "review", reviewReason: "late" }));
		const w = await widgetText();
		expect(w).toContain("Wallet host silent for 12 min. 1 review item.");
	});
});
