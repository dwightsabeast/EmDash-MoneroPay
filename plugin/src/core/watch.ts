/**
 * Which invoices the bridge keeps reporting (docs/spec.md, `bridge/sync`, "Watch list").
 */
import { FINAL_DEPTH, LATE_WINDOW_MS } from "./constants";
import { type Invoice, isOpen, totals } from "./invoice";

/**
 * Open invoices; expired and review invoices inside the 24-hour late window; settled invoices until their payment is
 * 10 deep (or re-confirming after a reorg), capped at 24 hours after settling so the list can't grow forever.
 */
export function isWatched(inv: Invoice, now: number): boolean {
	if (isOpen(inv)) return true;
	if (inv.status === "expired" || inv.status === "review") return now < inv.expiresAt + LATE_WINDOW_MS;
	if (inv.status === "settled") {
		if (inv.settledAt === undefined || now >= inv.settledAt + LATE_WINDOW_MS) return false;
		return inv.reconfirmingSince !== undefined || totals(inv).depth < FINAL_DEPTH;
	}
	return false;
}
