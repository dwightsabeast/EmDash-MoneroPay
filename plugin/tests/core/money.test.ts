import { describe, expect, it } from "vitest";

import { ATOMIC_PER_XMR } from "../../src/core/constants";
import { atomicToXmr, ceilDiv, decimalToMinor, expectedAtomic, paidThreshold, priceToMinor, xmrToAtomic } from "../../src/core/money";

describe("expectedAtomic = ceil(fiatMinor * 10^12 / rateMinor)", () => {
	it("is exact when the division is exact", () => {
		// $12.00 at $150.00 per XMR = 0.08 XMR.
		expect(expectedAtomic(1200n, 15000n)).toBe(80_000_000_000n);
	});
	it("rounds up, never down", () => {
		// $1.00 at $3.00 per XMR = 0.333... XMR -> ...334.
		expect(expectedAtomic(100n, 300n)).toBe(333_333_333_334n);
		expect(ceilDiv(10n, 3n)).toBe(4n);
		expect(ceilDiv(9n, 3n)).toBe(3n);
	});
	it("stays exact for large values (no float anywhere)", () => {
		// $9,999,999,999.99 at $0.01 per XMR.
		expect(expectedAtomic(999_999_999_999n, 1n)).toBe(999_999_999_999n * ATOMIC_PER_XMR);
	});
	it("rejects zero and negative amounts and rates", () => {
		expect(() => expectedAtomic(0n, 15000n)).toThrow(RangeError);
		expect(() => expectedAtomic(-1n, 15000n)).toThrow(RangeError);
		expect(() => expectedAtomic(1200n, 0n)).toThrow(RangeError);
		expect(() => expectedAtomic(1200n, -5n)).toThrow(RangeError);
	});
});

describe("tolerance: paid at or above 99.5% of expected", () => {
	it("is exactly 99.5%, rounded up", () => {
		expect(paidThreshold(1000n)).toBe(995n);
		expect(paidThreshold(80_000_000_000n)).toBe(79_600_000_000n);
		// 99.5% of 1001 = 995.995 -> 996.
		expect(paidThreshold(1001n)).toBe(996n);
	});
});

describe("XMR strings", () => {
	it("round-trips exactly at 12 decimals", () => {
		for (const atomic of [0n, 1n, 80_000_000_000n, 123_456_789_012n, 18_400_000n * ATOMIC_PER_XMR + 1n]) {
			const text = atomicToXmr(atomic);
			expect(text).toMatch(/^\d+\.\d{12}$/);
			expect(xmrToAtomic(text)).toBe(atomic);
		}
		expect(atomicToXmr(80_000_000_000n)).toBe("0.080000000000");
	});
	it("parses plain decimals and refuses anything else", () => {
		expect(xmrToAtomic("0.5")).toBe(500_000_000_000n);
		expect(xmrToAtomic("1")).toBe(ATOMIC_PER_XMR);
		for (const bad of ["", ".5", "1.", "-1", "1e3", "0.0000000000001", "1,5", " 1", "0x10"]) expect(xmrToAtomic(bad)).toBeNull();
	});
});

describe("fiat minor units", () => {
	it("parses decimal strings with at most the currency's decimals", () => {
		expect(decimalToMinor("19.99")).toBe(1999n);
		expect(decimalToMinor("250")).toBe(25000n);
		expect(decimalToMinor("0.5")).toBe(50n);
		expect(decimalToMinor("1.999")).toBeNull();
		expect(decimalToMinor("1500", 0)).toBe(1500n);
	});
	it("converts a stored product price through its shortest decimal string", () => {
		expect(priceToMinor(19.99)).toBe(1999n);
		expect(priceToMinor(1)).toBe(100n);
		expect(priceToMinor(250)).toBe(25000n);
		expect(priceToMinor(0.07)).toBe(7n);
		expect(priceToMinor(1.1 * 3)).toBeNull(); // 3.3000000000000003: refused, not rounded
		expect(priceToMinor(0.1 + 0.2)).toBeNull();
	});
	it("refuses non-prices", () => {
		for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.005, "19.99", null, undefined, 1e21, 1e-7]) {
			expect(priceToMinor(bad)).toBeNull();
		}
	});
});
