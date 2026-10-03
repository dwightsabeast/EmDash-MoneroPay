// The proof of concept's scenarios (docs/poc/poc-simulation.js, "Scenarios") and the core-level attacks, run through
// the pure core, plus the spec's newer rules (expire on evidence, spec change 5, the undecided-transfer wait).
import { describe, expect, it } from "vitest";

import { ATOMIC_PER_XMR } from "../../src/core/constants";
import { totals } from "../../src/core/invoice";
import { isWatched } from "../../src/core/watch";
import { Sim } from "./sim";

const statuses = (sim: Sim) => sim.events.filter((e) => e.type === "status").map((e) => (e.type === "status" ? e.to : ""));
const alerts = (sim: Sim) => sim.events.filter((e) => e.type === "alert");

describe("POC scenarios", () => {
	it("pay in full: confirming at 0 confirmations, settled at the required depth, never before", () => {
		const sim = new Sim(); // $12.00 at $150 = 0.08 XMR, Standard under 100 -> 2 confirmations
		expect(sim.inv.required).toBe(2);
		sim.pay(sim.expected);
		sim.sync();
		expect(sim.inv.status).toBe("confirming");
		sim.mine();
		sim.sync();
		expect(sim.inv.status).toBe("confirming"); // 1 of 2
		sim.mine();
		sim.sync();
		expect(sim.inv.status).toBe("settled");
		expect(statuses(sim)).toEqual(["confirming", "settled"]);
		expect(sim.inv.settledAt).toBe(sim.now);
		expect(sim.inv.finalAt).toBe(sim.now);
		expect(sim.inv.overpaidAtomic).toBeUndefined();
	});

	it("pay in two parts: seen, then confirming; settles when the newer transfer is deep enough", () => {
		const sim = new Sim({ fiatMinor: 15000n }); // $150 -> 1 XMR, Standard 100 to 1,000 -> 5
		expect(sim.inv.required).toBe(5);
		sim.pay((sim.expected * 6n) / 10n);
		sim.sync();
		expect(sim.inv.status).toBe("seen");
		sim.mine(3);
		sim.pay((sim.expected * 4n) / 10n);
		sim.sync();
		expect(sim.inv.status).toBe("confirming");
		sim.mine(4); // newer part at 4 confirmations, older at 7
		sim.sync();
		expect(sim.inv.status).toBe("confirming");
		sim.mine();
		sim.sync();
		expect(sim.inv.status).toBe("settled");
		expect(totals(sim.inv).depth).toBe(5);
	});

	it("underpay and leave: review (underpaid) after the post-deadline sync", () => {
		const sim = new Sim();
		sim.pay((sim.expected * 6n) / 10n);
		sim.mine();
		sim.sync();
		expect(sim.inv.status).toBe("seen");
		sim.mine(20); // past the window and the grace
		sim.sync();
		expect(sim.inv).toMatchObject({ status: "review", reviewReason: "underpaid" });
	});

	it("pay after expiry: expired, then review (late), never settled on its own", () => {
		const sim = new Sim();
		sim.mine(20);
		sim.sync();
		expect(sim.inv.status).toBe("expired");
		sim.pay(sim.expected);
		sim.sync();
		expect(sim.inv).toMatchObject({ status: "review", reviewReason: "late" });
		sim.mine(5);
		sim.sync();
		expect(sim.inv.status).toBe("review"); // admin decides
	});

	it("reorg after settling: stays settled, re-confirming, no alert; re-confirms when mined again", () => {
		const sim = new Sim();
		sim.pay(sim.expected);
		sim.mine(2);
		sim.sync();
		expect(sim.inv.status).toBe("settled");
		sim.reorg(2);
		sim.sync();
		expect(sim.inv.status).toBe("settled");
		expect(sim.inv.reconfirmingSince).toBe(sim.height);
		expect(sim.events.some((e) => e.type === "reconfirming")).toBe(true);
		sim.mine(2);
		sim.sync();
		expect(sim.inv.status).toBe("settled");
		expect(sim.inv.reconfirmingSince).toBeUndefined();
		expect(sim.events.some((e) => e.type === "reconfirmed")).toBe(true);
		expect(alerts(sim)).toEqual([]);
	});

	it("not mined again within 5 blocks after a reorg: review (reorg) with an alert", () => {
		const sim = new Sim();
		sim.pay(sim.expected);
		sim.mine(2);
		sim.sync();
		sim.reorg(2);
		sim.sync();
		sim.mine(4, false);
		sim.sync();
		expect(sim.inv.status).toBe("settled"); // 4 blocks: still waiting
		sim.mine(1, false);
		sim.sync();
		expect(sim.inv).toMatchObject({ status: "review", reviewReason: "reorg" });
		expect(alerts(sim)).toEqual([{ type: "alert", kind: "reorg" }]);
	});

	it("payment reversed: review (reversed) with an alert at once", () => {
		const sim = new Sim();
		sim.pay(sim.expected);
		sim.mine(2);
		sim.sync();
		sim.reorg(2, true);
		sim.sync();
		expect(sim.inv).toMatchObject({ status: "review", reviewReason: "reversed" });
		expect(alerts(sim)).toEqual([{ type: "alert", kind: "reversed" }]);
	});

	it("bridge outage across expiry: pendingExpiry instead of expiring, then settles on time", () => {
		const sim = new Sim();
		sim.wait(2 * 60_000);
		sim.pay(sim.expected); // 2 minutes in; the wallet sees it, nobody tells the site
		sim.mine(18);
		sim.tick(); // backup cron or a status read, no sync since checkout
		expect(sim.inv.status).toBe("new");
		expect(sim.inv.pendingExpiry).toBe(true);
		expect(sim.events.some((e) => e.type === "pendingExpiry")).toBe(true);
		sim.mine(2);
		sim.sync(); // the bridge is back: first report, already mined inside the window
		expect(sim.inv.status).toBe("settled");
		expect(sim.inv.pendingExpiry).toBeUndefined();
	});

	it("speed changed mid-invoice: the target stays locked", () => {
		const sim = new Sim({ speed: "standard" });
		// The owner switches to Strict now; the open invoice keeps its stored target.
		sim.pay(sim.expected);
		sim.mine(2);
		sim.sync();
		expect(sim.inv).toMatchObject({ status: "settled", required: 2 });
	});

	it("tip-shaped invoice settles at the dust floor and the lowest tier", () => {
		const sim = new Sim({ kind: "tip", fiatMinor: null, speed: "standard" });
		expect(sim.inv).toMatchObject({ expectedAtomic: null, minAtomic: "100000000", required: 2 });
		sim.pay(99_999_999n);
		sim.mine(2);
		sim.sync();
		expect(sim.inv.status).toBe("seen");
		sim.pay(1n);
		sim.mine(2);
		sim.sync();
		expect(sim.inv.status).toBe("settled");
	});

	it("overpayment settles and records the excess", () => {
		const sim = new Sim();
		sim.pay(sim.expected + 5n);
		sim.mine(2);
		sim.sync();
		expect(sim.inv).toMatchObject({ status: "settled", overpaidAtomic: "5" });
	});

	it("exactly 99.5% settles; one atomic unit less is underpaid", () => {
		const paid = new Sim();
		paid.pay((paid.expected * 995n) / 1000n);
		paid.mine(2);
		paid.sync();
		expect(paid.inv.status).toBe("settled");
		const short = new Sim();
		short.pay((short.expected * 995n) / 1000n - 1n);
		short.mine(2);
		short.sync();
		expect(short.inv.status).toBe("seen");
	});
});

describe("attacks the core must refuse", () => {
	it("time-locked funds are not counted (unlock_time, never `locked`)", () => {
		const sim = new Sim();
		sim.pay(sim.expected, { unlockTime: "3000100" });
		sim.mine(12);
		sim.sync();
		expect(sim.inv.status).toBe("new");
		expect(totals(sim.inv).notCounted).toBe(1);
	});
	it("double-spend-flagged funds are not counted", () => {
		const sim = new Sim();
		sim.pay(sim.expected, { doubleSpendSeen: true });
		sim.sync();
		expect(sim.inv.status).toBe("new");
	});
	it("a not-counted transfer doesn't make an expired invoice late", () => {
		const sim = new Sim();
		sim.mine(20);
		sim.sync();
		sim.pay(sim.expected, { unlockTime: "1" });
		sim.sync();
		expect(sim.inv.status).toBe("expired");
	});
});

describe("expire on evidence and on-time evidence (spec changes 2 and 5)", () => {
	it("no expiry from the clock alone: the backup cron only marks pendingExpiry", () => {
		const sim = new Sim();
		sim.sync(); // a sync before the deadline
		sim.mine(20);
		sim.tick();
		expect(sim.inv).toMatchObject({ status: "new", pendingExpiry: true });
		sim.sync();
		expect(sim.inv.status).toBe("expired");
	});

	it("any one piece of evidence is enough: mined by expiresHeight counts, however first reported", () => {
		// The wallet host is offline when the buyer pays in time; it comes back after the deadline while the payment is
		// still unmined, so seenAt and poolTs are both late. Mined at a height inside the window: on time.
		const sim = new Sim();
		sim.walletOnline = false;
		sim.mine(14);
		sim.pay(sim.expected);
		sim.wait(20 * 60_000); // past expiresAt by the clock, no new block
		sim.walletBack();
		sim.sync();
		expect(sim.inv.expiresAt).toBeLessThan(sim.now);
		expect(sim.height).toBeLessThan(sim.inv.expiresHeight);
		expect(sim.inv).toMatchObject({ status: "new", pendingExpiry: true }); // undecided: could still be mined in time
		sim.mine(1); // mined at expiresHeight - 3: inside the window
		sim.sync();
		expect(sim.inv.status).toBe("confirming");
		sim.mine(1);
		sim.sync();
		expect(sim.inv.status).toBe("settled");
	});

	it("an unmined transfer becomes late only once it can't be mined by expiresHeight", () => {
		const sim = new Sim();
		sim.mine(17); // chain at expiresHeight - 1
		sim.wait(60 * 60_000);
		sim.pay(sim.expected);
		sim.sync();
		expect(sim.inv).toMatchObject({ status: "new", pendingExpiry: true });
		sim.mine(1, false); // chain reaches expiresHeight, still unmined: can't be in time any more
		sim.sync();
		expect(sim.inv).toMatchObject({ status: "review", reviewReason: "late" });
	});

	it("inclusive boundaries: seen exactly at expiresAt is on time; mined exactly at expiresHeight is on time", () => {
		const atDeadline = new Sim();
		atDeadline.wait(30 * 60_000); // now === expiresAt
		atDeadline.pay(atDeadline.expected);
		atDeadline.sync();
		atDeadline.mine(2);
		atDeadline.sync();
		expect(atDeadline.inv.status).toBe("settled");

		const lastBlock = new Sim();
		lastBlock.walletOnline = false;
		lastBlock.mine(17);
		lastBlock.pay(lastBlock.expected);
		lastBlock.mine(1); // mined at exactly expiresHeight
		lastBlock.wait(60 * 60_000);
		lastBlock.walletBack();
		lastBlock.mine(1);
		lastBlock.sync();
		expect(lastBlock.inv.status).toBe("settled");
	});

	it("an expired invoice reopens when a payment made in time turns up", () => {
		const sim = new Sim();
		sim.walletOnline = false;
		sim.wait(5 * 60_000);
		sim.pay(sim.expected); // in time, but the wallet host is down
		sim.mine(20); // mined inside the window, chain now past it
		sim.inv = { ...sim.inv, status: "expired", seq: sim.now, finalAt: sim.now }; // expired by an earlier empty sync
		sim.walletBack();
		sim.sync();
		expect(sim.inv).toMatchObject({ status: "settled", reopened: true });
		expect(sim.events.some((e) => e.type === "reopened")).toBe(true);
	});

	it("an on-time partial payment reported after expiry goes to review (underpaid), not silently expired", () => {
		const sim = new Sim();
		sim.walletOnline = false;
		sim.pay(sim.expected / 2n);
		sim.mine(20);
		sim.inv = { ...sim.inv, status: "expired", seq: sim.now, finalAt: sim.now };
		sim.walletBack();
		sim.sync();
		expect(sim.inv).toMatchObject({ status: "review", reviewReason: "underpaid" });
	});

	it("a tip below the dust floor at expiry just expires (phase 07 decides)", () => {
		const sim = new Sim({ kind: "tip", fiatMinor: null });
		sim.pay(50n);
		sim.mine(20);
		sim.sync();
		expect(sim.inv.status).toBe("expired");
	});

	it("an admin decision is final", () => {
		const sim = new Sim();
		sim.inv = { ...sim.inv, status: "settled", adminFinal: true };
		sim.mine(20);
		sim.sync();
		expect(sim.inv.status).toBe("settled");
		expect(sim.events).toEqual([]);
	});
});

describe("watch list", () => {
	it("watches open invoices, expired and review ones for 24 hours, settled ones until 10 deep", () => {
		const sim = new Sim();
		expect(isWatched(sim.inv, sim.now)).toBe(true); // new
		sim.pay(sim.expected);
		sim.mine(2);
		sim.sync();
		expect(sim.inv.status).toBe("settled");
		expect(isWatched(sim.inv, sim.now)).toBe(true); // 2 deep
		sim.mine(7);
		sim.sync();
		expect(isWatched(sim.inv, sim.now)).toBe(true); // 9 deep
		sim.mine(1);
		sim.sync();
		expect(isWatched(sim.inv, sim.now)).toBe(false); // 10 deep: done

		const late = new Sim();
		late.mine(20);
		late.sync();
		expect(late.inv.status).toBe("expired");
		expect(isWatched(late.inv, late.inv.expiresAt + 24 * 3_600_000 - 1)).toBe(true);
		expect(isWatched(late.inv, late.inv.expiresAt + 24 * 3_600_000)).toBe(false);
	});

	it("keeps a re-confirming settled invoice watched, but never past 24 hours after settling", () => {
		const sim = new Sim();
		sim.pay(sim.expected);
		sim.mine(12);
		sim.sync();
		sim.reorg(12);
		sim.sync();
		expect(sim.inv.reconfirmingSince).toBeDefined();
		expect(isWatched(sim.inv, sim.now)).toBe(true);
		expect(isWatched(sim.inv, (sim.inv.settledAt ?? 0) + 24 * 3_600_000)).toBe(false);
	});

	it("1 XMR is 10^12 atomic units", () => {
		expect(ATOMIC_PER_XMR).toBe(1_000_000_000_000n);
	});
});
