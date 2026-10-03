import { describe, expect, it } from "vitest";

import { requiredConfirmations, raiseRequired } from "../../src/core/presets";
import { newInvoice } from "../../src/core/invoice";

describe("confirmation presets by order value", () => {
	const cases: Array<[bigint, number, number, number]> = [
		// fiatMinor, fast, standard, strict
		[1n, 1, 2, 10],
		[9_999n, 1, 2, 10], // 99.99: under 100
		[10_000n, 3, 5, 10], // 100.00: "100 to 1,000"
		[100_000n, 3, 5, 10], // 1,000.00: still "100 to 1,000"
		[100_001n, 5, 10, 10], // 1,000.01: over 1,000
		[999_999_999n, 5, 10, 10],
	];
	for (const [minor, fast, standard, strict] of cases) {
		it(`${minor} minor units -> fast ${fast}, standard ${standard}, strict ${strict}`, () => {
			expect(requiredConfirmations("product", minor, "fast")).toBe(fast);
			expect(requiredConfirmations("product", minor, "standard")).toBe(standard);
			expect(requiredConfirmations("product", minor, "strict")).toBe(strict);
			expect(requiredConfirmations("order", minor, "standard")).toBe(standard);
		});
	}
	it("tips use the lowest tier whatever the amount", () => {
		expect(requiredConfirmations("tip", 500_000n, "fast")).toBe(1);
		expect(requiredConfirmations("tip", null, "standard")).toBe(2);
		expect(requiredConfirmations("tip", 500_000n, "strict")).toBe(10);
	});
	it("takes the currency's decimals into account", () => {
		expect(requiredConfirmations("product", 99n, "standard", 0)).toBe(2);
		expect(requiredConfirmations("product", 100n, "standard", 0)).toBe(5);
	});
});

describe("required is locked at checkout; an admin can raise it, never lower it", () => {
	const make = (speed: "fast" | "standard" | "strict") =>
		newInvoice({
			id: "inv_1", token: "t", kind: "product", fiatMinor: 1200n, currency: "USD", rate: { minor: 15000n, source: "test" },
			speed, subaddress: "7abc", addrIndex: 1, now: 0, chainHeight: 100,
		});
	it("stores the target from the speed at checkout", () => {
		expect(make("standard").required).toBe(2);
		expect(make("strict").required).toBe(10);
	});
	it("raises an open invoice", () => {
		const r = raiseRequired(make("standard"), 10);
		expect(r).toMatchObject({ ok: true, invoice: { required: 10 } });
	});
	it("refuses lowering, equal, above 10, and closed invoices", () => {
		expect(raiseRequired(make("standard"), 1)).toEqual({ ok: false, code: "CANNOT_LOWER" });
		expect(raiseRequired(make("standard"), 2)).toEqual({ ok: false, code: "CANNOT_LOWER" });
		expect(raiseRequired(make("standard"), 11)).toEqual({ ok: false, code: "ABOVE_MAXIMUM" });
		expect(raiseRequired({ ...make("standard"), status: "settled" }, 5)).toEqual({ ok: false, code: "INVOICE_NOT_OPEN" });
		expect(raiseRequired({ ...make("standard"), status: "review" }, 5)).toEqual({ ok: false, code: "INVOICE_NOT_OPEN" });
	});
});
