// The pay page's state rules (shared by the server render and the browser) and the browser glue, against fakes.
import { describe, expect, it } from "vitest";

import { CLIENT_SCRIPT, type ClientEnv, clientMain, payState } from "../src/client";
import { status } from "./fixtures";

describe("payState", () => {
	it("each invoice status to what the page shows; only final states stop polling", () => {
		const cases: Array<[Parameters<typeof status>[0], string, boolean]> = [
			[{ status: "new" }, "waiting", false],
			[{ status: "new", pendingExpiry: true }, "checking", false],
			[{ status: "seen", receivedAtomic: "40000000000" }, "partial", false],
			[{ status: "seen", pendingExpiry: true }, "checking", false],
			[{ status: "confirming", confirmations: 1 }, "confirming", false],
			[{ status: "settled" }, "settled", true],
			[{ status: "settled", reconfirming: true }, "reconfirming", false],
			[{ status: "expired" }, "expired", true],
			[{ status: "review" }, "review", true],
		];
		for (const [o, state, final] of cases) expect(payState(status(o)), JSON.stringify(o)).toMatchObject({ state, final });
		expect(payState({ error: { code: "INVOICE_NOT_FOUND" } })).toMatchObject({ state: "notfound", final: true });
	});

	it("counters and the received amount, in XMR without trailing zeros, BigInt only", () => {
		expect(payState(status({ status: "confirming", confirmations: 1, required: 10, receivedAtomic: "80000000000" }))).toEqual({ state: "confirming", final: false, confirmations: 1, required: 10, received: "0.08" });
		expect(payState(status({ status: "seen", receivedAtomic: "123456789012345678" }))?.received).toBe("123456.789012345678");
		expect(payState(status({ receivedAtomic: "0" }))?.received).toBe("0");
	});

	it("null for anything it can't trust, so the page keeps what it shows", () => {
		for (const bad of [null, undefined, "x", 3, {}, { status: "new" }, { status: "paid", receivedAtomic: "0" }, { status: "new", receivedAtomic: "1e9" }, { status: "new", receivedAtomic: "-1" }, { error: { code: "OTHER" } }])
			expect(payState(bad), JSON.stringify(bad)).toBeNull();
	});
});

/** Just enough DOM for clientMain: elements with attributes, hidden, textContent and click listeners. */
class El {
	attrs: Record<string, string>;
	hidden: boolean;
	textContent: string;
	listeners: Array<() => void> = [];
	constructor(attrs: Record<string, string>, text = "", hidden = false) {
		this.attrs = attrs;
		this.textContent = text;
		this.hidden = hidden;
	}
	getAttribute(n: string) { return this.attrs[n] ?? null; }
	setAttribute(n: string, v: string) { this.attrs[n] = v; }
	addEventListener(_: string, f: () => void) { this.listeners.push(f); }
}

function page(state: string, final = false) {
	const els = {
		root: new El({ "data-coffer-pay": "", "data-state": state, "data-final": String(final), "data-status-url": "/_emdash/api/plugins/coffer/status?token=T", "data-expires-at": new Date(1_000_000 + 125_000).toISOString() }),
		waiting: new El({ "data-show": "waiting" }, "", state !== "waiting"),
		confirming: new El({ "data-show": "confirming" }, "", state !== "confirming"),
		settled: new El({ "data-show": "settled" }, "", state !== "settled"),
		details: new El({ "data-show": "waiting partial checking" }, "", !["waiting", "partial", "checking"].includes(state)),
		countdown: new El({ "data-field": "countdown" }, "?"),
		confirmations: new El({ "data-field": "confirmations" }, "0"),
		required: new El({ "data-field": "required" }, "2"),
		address: new El({ "data-field": "address" }, " 7ADDR \n"),
		copy: new El({ "data-copy": "address" }, "Copy", true),
	};
	const all = Object.values(els).filter((e) => e !== els.root);
	const root = Object.assign(els.root, {
		querySelectorAll: (sel: string) => {
			if (sel === "[data-show]") return all.filter((e) => "data-show" in e.attrs);
			if (sel === "[data-copy]") return all.filter((e) => "data-copy" in e.attrs);
			const m = /^\[data-field="(\w+)"\]$/.exec(sel);
			return m ? all.filter((e) => e.attrs["data-field"] === m[1]) : [];
		},
		querySelector: (sel: string) => root.querySelectorAll(sel)[0] ?? null,
	});
	return { els, document: { hidden: false, querySelector: (sel: string) => (sel === "[data-coffer-pay]" ? root : null) } };
}

function env(document: ClientEnv["document"], replies: unknown[]) {
	const timers: Array<{ fn: () => void; ms: number }> = [];
	const fetched: string[] = [];
	const copied: string[] = [];
	let now = 1_000_000;
	const e: ClientEnv = {
		document,
		fetch: async (url) => {
			fetched.push(url);
			const r = replies.shift();
			if (r instanceof Error) throw r;
			return { json: async () => r };
		},
		setTimeout: (fn, ms) => timers.push({ fn, ms }),
		now: () => now,
		clipboard: { writeText: async (t) => void copied.push(t) },
	};
	/** Runs the next timer with the given delay. */
	const run = async (ms: number) => {
		const i = timers.findIndex((t) => t.ms === ms);
		if (i < 0) return false;
		const [t] = timers.splice(i, 1);
		now += ms;
		await t.fn();
		return true;
	};
	return { e, timers, fetched, copied, run };
}

describe("clientMain", () => {
	it("polls every 5 s, moves waiting → confirming → settled, and stops once final", async () => {
		const { els, document } = page("waiting");
		const t = env(document, [
			{ success: true, data: status({ status: "new" }) },
			{ success: true, data: status({ status: "confirming", confirmations: 1 }) },
			{ success: true, data: status({ status: "settled", confirmations: 2 }) },
		]);
		clientMain(payState, t.e);
		expect(els.countdown.textContent).toBe("2:05");
		await t.run(5000);
		expect(els.root.attrs["data-state"]).toBe("waiting");
		await t.run(5000);
		expect(els.root.attrs["data-state"]).toBe("confirming");
		expect([els.waiting.hidden, els.confirming.hidden, els.details.hidden]).toEqual([true, false, true]);
		expect(els.confirmations.textContent).toBe("1");
		await t.run(5000);
		expect(els.root.attrs["data-state"]).toBe("settled");
		expect(els.settled.hidden).toBe(false);
		expect(t.fetched).toEqual(Array(3).fill("/_emdash/api/plugins/coffer/status?token=T"));
		expect(await t.run(5000)).toBe(false); // no more polling
	});

	it("keeps what it shows on a network error or a failed reply, and asks again", async () => {
		const { els, document } = page("waiting");
		const t = env(document, [new Error("offline"), { success: false, error: { code: "X" } }, { success: true, data: status({ status: "confirming" }) }]);
		clientMain(payState, t.e);
		await t.run(5000);
		await t.run(5000);
		expect(els.root.attrs["data-state"]).toBe("waiting");
		await t.run(5000);
		expect(els.root.attrs["data-state"]).toBe("confirming");
	});

	it("doesn't poll a page rendered final, or while the tab is hidden", async () => {
		const done = page("settled", true);
		const t1 = env(done.document, []);
		clientMain(payState, t1.e);
		expect(t1.timers.filter((t) => t.ms === 5000)).toEqual([]);
		const bg = page("waiting");
		bg.document.hidden = true;
		const t2 = env(bg.document, []);
		clientMain(payState, t2.e);
		await t2.run(5000);
		expect(t2.fetched).toEqual([]);
		expect(t2.timers.some((t) => t.ms === 5000)).toBe(true); // tries again later
	});

	it("the countdown ticks each second and stops at 0:00", async () => {
		const { els, document } = page("waiting");
		const t = env(document, []);
		clientMain(payState, t.e);
		await t.run(1000);
		expect(els.countdown.textContent).toBe("2:04");
		for (let i = 0; i < 200 && (await t.run(1000)); i++);
		expect(els.countdown.textContent).toBe("0:00");
	});

	it("Copy appears only with a clipboard, and copies the trimmed text", async () => {
		const { els, document } = page("waiting");
		const t = env(document, []);
		clientMain(payState, t.e);
		expect(els.copy.hidden).toBe(false);
		els.copy.listeners[0]();
		await Promise.resolve();
		await Promise.resolve();
		expect(t.copied).toEqual(["7ADDR"]);
		expect(els.copy.textContent).toBe("Copied");
		const noClip = page("waiting");
		const t2 = env(noClip.document, []);
		delete t2.e.clipboard;
		clientMain(payState, t2.e);
		expect(noClip.els.copy.hidden).toBe(true);
	});
});

describe("CLIENT_SCRIPT", () => {
	it("runs on its own: both functions are self-contained, with only the browser's globals", async () => {
		const { els, document } = page("waiting");
		const t = env(document, [{ success: true, data: status({ status: "settled" }) }]);
		const fn = new Function("document", "fetch", "setTimeout", "Date", "navigator", CLIENT_SCRIPT);
		fn(document, t.e.fetch, t.e.setTimeout, { now: t.e.now, parse: Date.parse }, { clipboard: t.e.clipboard });
		await t.run(5000);
		expect(els.root.attrs["data-state"]).toBe("settled");
	});
});
