/**
 * Money math: BigInt atomic units and integer fiat minor units only. No Number arithmetic on amounts.
 */
import { ATOMIC_PER_XMR, FIAT_DECIMALS, TOLERANCE_PERMILLE } from "./constants";

/** ceil(a / b) for a >= 0, b > 0. */
export function ceilDiv(a: bigint, b: bigint): bigint {
	if (b <= 0n) throw new RangeError("divisor must be positive");
	if (a < 0n) throw new RangeError("dividend must not be negative");
	return (a + b - 1n) / b;
}

/** expectedAtomic = ceil(fiatMinor * 10^12 / rateMinor), where rateMinor is the price of 1 XMR in the same minor units. */
export function expectedAtomic(fiatMinor: bigint, rateMinor: bigint): bigint {
	if (fiatMinor <= 0n) throw new RangeError("fiat amount must be positive");
	if (rateMinor <= 0n) throw new RangeError("rate must be positive");
	return ceilDiv(fiatMinor * ATOMIC_PER_XMR, rateMinor);
}

/** The smallest received amount that counts as paid: ceil(expected * 99.5%). */
export function paidThreshold(expected: bigint): bigint {
	if (expected <= 0n) throw new RangeError("expected amount must be positive");
	return ceilDiv(expected * TOLERANCE_PERMILLE, 1000n);
}

/** Exact XMR string with all 12 decimals, for amounts and monero: URIs. */
export function atomicToXmr(atomic: bigint): string {
	if (atomic < 0n) throw new RangeError("amount must not be negative");
	const whole = atomic / ATOMIC_PER_XMR;
	const frac = (atomic % ATOMIC_PER_XMR).toString().padStart(12, "0");
	return `${whole}.${frac}`;
}

const XMR_RE = /^(\d{1,9})(?:\.(\d{1,12}))?$/;

/** Parses a plain decimal XMR string ("0.5", "12.000000000001") into atomic units, or null if it isn't one. */
export function xmrToAtomic(text: string): bigint | null {
	const m = XMR_RE.exec(text);
	if (!m) return null;
	return BigInt(m[1]) * ATOMIC_PER_XMR + BigInt((m[2] ?? "").padEnd(12, "0"));
}

/** Parses a plain decimal string ("19.99", "250") into minor units, or null if it has more decimals than the currency. */
export function decimalToMinor(text: string, decimals: number = FIAT_DECIMALS): bigint | null {
	const m = /^(\d{1,15})(?:\.(\d+))?$/.exec(text);
	if (!m) return null;
	const frac = m[2] ?? "";
	if (frac.length > decimals) return null;
	return BigInt(m[1]) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

/**
 * A product's price as stored by EmDash (a number; SQLite REAL) to minor units, without float math:
 * through the number's shortest round-trip decimal string. Null for anything that isn't a positive price
 * with at most `decimals` decimals (so 0.1 + 0.2 = 0.30000000000000004 is refused, not rounded).
 */
export function priceToMinor(price: unknown, decimals: number = FIAT_DECIMALS): bigint | null {
	if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return null;
	const minor = decimalToMinor(String(price), decimals);
	return minor !== null && minor > 0n ? minor : null;
}
