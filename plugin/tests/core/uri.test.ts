// The one monero: URI builder (spec change 32).
import { describe, expect, it } from "vitest";

import { invoiceUri, paymentUri } from "../../src/core/uri";

const A = `5${"S".repeat(94)}`;

describe("paymentUri", () => {
	it("amount with all 12 decimals, description percent-encoded, each only when given", () => {
		expect(paymentUri(A, 1_500_000_000_000n, "Tea & mugs")).toBe(`monero:${A}?tx_amount=1.500000000000&tx_description=Tea%20%26%20mugs`);
		expect(paymentUri(A, 100_000_000n)).toBe(`monero:${A}?tx_amount=0.000100000000`);
		expect(paymentUri(A, null, "Tip")).toBe(`monero:${A}?tx_description=Tip`);
		expect(paymentUri(A, null)).toBe(`monero:${A}`);
		expect(paymentUri(A, null, "")).toBe(`monero:${A}`);
	});

	it("an invoice: its expected amount, else a tip's floor", () => {
		expect(invoiceUri({ subaddress: A, expectedAtomic: "80000000000", minAtomic: null, uriDescription: "Book" })).toBe(`monero:${A}?tx_amount=0.080000000000&tx_description=Book`);
		expect(invoiceUri({ subaddress: A, expectedAtomic: null, minAtomic: "100000000" })).toBe(`monero:${A}?tx_amount=0.000100000000`);
	});
});
