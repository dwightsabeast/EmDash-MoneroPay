/**
 * The spec's fixed values (docs/spec.md, "Invoice lifecycle and payment logic" and "Admin setup and upkeep").
 * Starting values, to tune on stagenet and with real use (spec open question 9). Not settings.
 */

/** 1 XMR = 10^12 atomic units. */
export const ATOMIC_PER_XMR = 10n ** 12n;

/** Received at or above 99.5% of expected counts as paid. */
export const TOLERANCE_PERMILLE = 995n;

/** The invoice window, and the same window in blocks (2-minute blocks) plus a grace for payments sent just in time. */
export const INVOICE_WINDOW_MS = 30 * 60_000;
export const WINDOW_BLOCKS = 15;
export const EXPIRY_GRACE_BLOCKS = 3;

/** Expired and review invoices stay watched this long after expiresAt; settled ones this long after settledAt at most. */
export const LATE_WINDOW_MS = 24 * 3_600_000;

/** Settled invoices stay watched until their payment is this deep (Monero's 10-block spend lock). */
export const FINAL_DEPTH = 10;

/** A settled payment knocked out by a reorg must be mined again within this many blocks, or it goes to review. */
export const RECONFIRM_BLOCKS = 5;

/** The wallet host counts as silent when its last sync is older than this (spec change 2): the admin alert shows and
 * checkout refuses (spec change 16). */
export const SILENT_MS = 5 * 60_000;

/** The unpaid address gap (highest claimed pool index minus the highest paid one) that turns the admin page's line red:
 * wallet apps look about 200 addresses past the last paid one (spec change 9). A constant, never a setting. */
export const GAP_ALERT = 150;

/** This many unpaid expired checkouts in a row turn an admin page line amber (buyers may be stuck on the pay page). */
export const UNPAID_RUN_ALERT = 10;

/** A reinstall's suggested restore height is this far below the oldest watched invoice's createdHeight (about a day),
 * because createdHeight runs high when blocks come slower than every 2 minutes (spec change 17). */
export const RESTORE_MARGIN_BLOCKS = 720;

/** Tips settle at or above this many atomic units (0.0001 XMR). */
export const DUST_ATOMIC = 100_000_000n;

/** The highest confirmation requirement an invoice can have (the top preset tier). */
export const MAX_REQUIRED = 10;

/** Fiat currencies with two minor-unit decimals only, for now (session 2b decision; the count is a parameter where it matters). */
export const FIAT_DECIMALS = 2;

/** Confirmations by order value: [under 100, 100 to 1,000, over 1,000] in the site currency's major units. */
export const PRESETS = {
	fast: [1, 3, 5],
	standard: [2, 5, 10],
	strict: [10, 10, 10],
} as const satisfies Record<string, readonly [number, number, number]>;

export type Speed = keyof typeof PRESETS;
