/**
 * Confirmation targets (docs/spec.md, "Confirmation presets"), locked on the invoice at checkout.
 */
import { FIAT_DECIMALS, MAX_REQUIRED, PRESETS, type Speed } from "./constants";
import type { Invoice, InvoiceKind } from "./invoice";

/**
 * Under 100 major units: tier 0; 100 to 1,000 (inclusive): tier 1; over 1,000: tier 2. Tips (and amountless invoices)
 * use tier 0. Integer comparison in minor units.
 */
export function requiredConfirmations(kind: InvoiceKind, fiatMinor: bigint | null, speed: Speed, decimals: number = FIAT_DECIMALS): number {
	const tiers = PRESETS[speed];
	if (kind === "tip" || fiatMinor === null) return tiers[0];
	const unit = 10n ** BigInt(decimals);
	if (fiatMinor < 100n * unit) return tiers[0];
	if (fiatMinor <= 1000n * unit) return tiers[1];
	return tiers[2];
}

export type RaiseResult = { ok: true; invoice: Invoice } | { ok: false; code: "INVOICE_NOT_OPEN" | "CANNOT_LOWER" | "ABOVE_MAXIMUM" };

/** An admin may raise (never lower) the target of one open invoice, up to the top tier. */
export function raiseRequired(inv: Invoice, to: number): RaiseResult {
	if (inv.status !== "new" && inv.status !== "seen" && inv.status !== "confirming") return { ok: false, code: "INVOICE_NOT_OPEN" };
	if (!Number.isSafeInteger(to) || to > MAX_REQUIRED) return { ok: false, code: "ABOVE_MAXIMUM" };
	if (to <= inv.required) return { ok: false, code: "CANNOT_LOWER" };
	return { ok: true, invoice: { ...inv, required: to } };
}
