/**
 * The invoice model and its state machine (docs/spec.md, "Invoice lifecycle and payment logic").
 * Pure: callers pass the time and the chain height; nothing here reads a clock, storage or the network.
 * Amounts are decimal strings at rest and BigInt in arithmetic.
 */
import {
	DUST_ATOMIC,
	EXPIRY_GRACE_BLOCKS,
	INVOICE_WINDOW_MS,
	RECONFIRM_BLOCKS,
	type Speed,
	WINDOW_BLOCKS,
} from "./constants";
import { expectedAtomic, paidThreshold } from "./money";
import { requiredConfirmations } from "./presets";

export type InvoiceKind = "product" | "tip" | "order";
export type InvoiceStatus = "new" | "seen" | "confirming" | "settled" | "expired" | "review";
export type ReviewReason = "late" | "underpaid" | "reorg" | "reversed";

/** One incoming transfer to the invoice's subaddress, as the bridge reported it plus what the plugin added. */
export interface Transfer {
	txid: string;
	amountAtomic: string;
	confirmations: number;
	/** 0 while unmined. */
	height: number;
	/** wallet-rpc's timestamp in seconds: when the wallet first saw it while unmined, or the block time once mined. */
	timestamp: number;
	doubleSpendSeen: boolean;
	/** wallet-rpc's unlock_time as a decimal string; only "0" is spendable money. */
	unlockTime: string;
	/** When the plugin first heard of this txid (ms). */
	seenAt: number;
	/** The first wallet timestamp reported while unmined (seconds), or null if first reported already mined. */
	poolTs: number | null;
}

export interface Invoice {
	id: string;
	token: string;
	kind: InvoiceKind;
	productRef?: { collection: string; id: string };
	contentRef?: { collection: string; id: string };
	orderRef?: string;
	returnUrl?: string;
	/** Fiat amount in minor units (decimal string); null for open-amount tips. */
	fiat: { amountMinor: string; currency: string } | null;
	/** The XMR price locked at checkout, in fiat minor units per XMR (decimal string). */
	rate: { minor: string; currency: string; source: string } | null;
	expectedAtomic: string | null;
	minAtomic: string | null;
	/** Confirmations required, locked at checkout. */
	required: number;
	subaddress: string;
	addrIndex: number;
	status: InvoiceStatus;
	reviewReason?: ReviewReason;
	createdAt: number;
	expiresAt: number;
	createdHeight: number;
	expiresHeight: number;
	pendingExpiry?: boolean;
	/** Chain height when a reorg knocked a settled payment shallower. */
	reconfirmingSince?: number;
	/** The bridge clock (ms) of the newest snapshot applied to this invoice. */
	seq: number;
	transfers: Transfer[];
	settledAt?: number;
	/** When the invoice first left the open states (ms); the 30-day buyer-data purge counts from here. */
	finalAt?: number;
	overpaidAtomic?: string;
	reopened?: boolean;
	/** An admin decision is final: evaluate() leaves the invoice alone. */
	adminFinal?: boolean;
	buyer?: { email?: string; note?: string; refundAddress?: string };
}

export const OPEN_STATUSES: ReadonlySet<InvoiceStatus> = new Set(["new", "seen", "confirming"]);
export const isOpen = (inv: Pick<Invoice, "status">) => OPEN_STATUSES.has(inv.status);

export interface NewInvoiceInput {
	id: string;
	token: string;
	kind: InvoiceKind;
	/** Fiat minor units, or null for an open-amount tip. */
	fiatMinor: bigint | null;
	/** Fixed XMR amount for a tip given in XMR (atomic units), instead of fiat. */
	xmrAtomic?: bigint | null;
	currency: string;
	rate: { minor: bigint; source: string } | null;
	speed: Speed;
	subaddress: string;
	addrIndex: number;
	now: number;
	chainHeight: number;
	productRef?: Invoice["productRef"];
	contentRef?: Invoice["contentRef"];
	orderRef?: string;
	returnUrl?: string;
	buyer?: Invoice["buyer"];
}

/** Builds the invoice record at checkout: amounts, the locked rate and confirmation target, and both deadlines. */
export function newInvoice(input: NewInvoiceInput): Invoice {
	let expected: bigint | null = null;
	if (input.fiatMinor !== null) {
		if (!input.rate) throw new RangeError("a fiat amount needs a rate");
		expected = expectedAtomic(input.fiatMinor, input.rate.minor);
	} else if (input.xmrAtomic != null) {
		if (input.xmrAtomic <= 0n) throw new RangeError("XMR amount must be positive");
		expected = input.xmrAtomic;
	}
	if (input.kind !== "tip" && expected === null) throw new RangeError("products and orders need an amount");
	const inv: Invoice = {
		id: input.id,
		token: input.token,
		kind: input.kind,
		fiat: input.fiatMinor !== null ? { amountMinor: input.fiatMinor.toString(), currency: input.currency } : null,
		rate: input.rate ? { minor: input.rate.minor.toString(), currency: input.currency, source: input.rate.source } : null,
		expectedAtomic: expected?.toString() ?? null,
		minAtomic: input.kind === "tip" ? DUST_ATOMIC.toString() : null,
		required: requiredConfirmations(input.kind, input.fiatMinor, input.speed),
		subaddress: input.subaddress,
		addrIndex: input.addrIndex,
		status: "new",
		createdAt: input.now,
		expiresAt: input.now + INVOICE_WINDOW_MS,
		createdHeight: input.chainHeight,
		expiresHeight: input.chainHeight + WINDOW_BLOCKS + EXPIRY_GRACE_BLOCKS,
		seq: 0,
		transfers: [],
	};
	if (input.productRef) inv.productRef = input.productRef;
	if (input.contentRef) inv.contentRef = input.contentRef;
	if (input.orderRef) inv.orderRef = input.orderRef;
	if (input.returnUrl) inv.returnUrl = input.returnUrl;
	if (input.buyer) inv.buyer = input.buyer;
	return inv;
}

/** Only spendable money counts: no time lock (unlock_time "0") and no double-spend flag. Never wallet-rpc's `locked`. */
export const counted = (t: Transfer) => !t.doubleSpendSeen && t.unlockTime === "0";

/**
 * Made inside the window? Any one is enough (spec change 5): the plugin saw it by expiresAt; the wallet first saw it
 * unmined by expiresAt; or it is mined at a height at most expiresHeight, however it was first reported.
 * Inclusive at the boundary. Block timestamps are never used.
 */
export function onTime(inv: Pick<Invoice, "expiresAt" | "expiresHeight">, t: Transfer): boolean {
	if (t.seenAt <= inv.expiresAt) return true;
	if (t.poolTs !== null && t.poolTs * 1000 <= inv.expiresAt) return true;
	return t.height > 0 && t.height <= inv.expiresHeight;
}

export interface Totals {
	/** Sum of the counted transfers (atomic units). */
	received: bigint;
	/** The amount that counts as paid. */
	threshold: bigint;
	/** Confirmations of the shallowest transfer needed to reach the threshold, deepest first; -1 if not reached. */
	depth: number;
	/** How many transfers are not counted (time-locked or double-spend flagged). */
	notCounted: number;
}

export function totals(inv: Invoice, include: (t: Transfer) => boolean = () => true): Totals {
	const use = inv.transfers.filter((t) => counted(t) && include(t));
	const received = use.reduce((sum, t) => sum + BigInt(t.amountAtomic), 0n);
	const threshold =
		inv.kind === "tip" && inv.minAtomic !== null ? BigInt(inv.minAtomic) : paidThreshold(BigInt(inv.expectedAtomic ?? "0"));
	let acc = 0n;
	let depth = -1;
	for (const t of [...use].sort((a, b) => b.confirmations - a.confirmations)) {
		acc += BigInt(t.amountAtomic);
		if (acc >= threshold) {
			depth = t.confirmations;
			break;
		}
	}
	return { received, threshold, depth, notCounted: inv.transfers.length - inv.transfers.filter(counted).length };
}

/** Before expiry everything counted counts; from expiresAt on, only payments made in time. */
export const basis = (inv: Invoice, now: number): Totals =>
	now >= inv.expiresAt ? totals(inv, (t) => onTime(inv, t)) : totals(inv);

export function classify(t: Totals, required: number): "new" | "seen" | "confirming" | "settled" {
	if (t.received === 0n) return "new";
	if (t.received < t.threshold) return "seen";
	return t.depth < required ? "confirming" : "settled";
}

/**
 * An unmined transfer that isn't proven on time could still be mined at or below expiresHeight while the chain is below
 * it: undecided, so the invoice waits (spec change 5 must hold even when the first report comes after the deadline).
 */
export const undecided = (inv: Invoice, t: Transfer, chainHeight: number) =>
	counted(t) && !onTime(inv, t) && t.height === 0 && chainHeight < inv.expiresHeight;

/** Definitely late: counted, not on time, and no longer able to be mined in time. */
const lateTransfer = (inv: Invoice, t: Transfer, chainHeight: number) =>
	counted(t) && !onTime(inv, t) && !undecided(inv, t, chainHeight);
const hasLate = (inv: Invoice, chainHeight: number) => inv.transfers.some((t) => lateTransfer(inv, t, chainHeight));
const hasUndecided = (inv: Invoice, chainHeight: number) => inv.transfers.some((t) => undecided(inv, t, chainHeight));

export type InvoiceEvent =
	| { type: "status"; from: InvoiceStatus; to: InvoiceStatus; reason?: ReviewReason }
	| { type: "alert"; kind: "reorg" | "reversed" }
	| { type: "reconfirming" }
	| { type: "reconfirmed" }
	| { type: "pendingExpiry" }
	| { type: "reopened" };

export interface Evaluation {
	invoice: Invoice;
	events: InvoiceEvent[];
	/** True if anything stored changed (status, pendingExpiry, reconfirming marker, or derived fields). */
	changed: boolean;
}

/**
 * Applies the lifecycle rules to an invoice whose transfers are already up to date.
 * `now` is the plugin's clock (ms); `chainHeight` the latest height a sync reported.
 * Expiry is on evidence: it needs `invoice.seq` (a sync's bridge time) at or after expiresAt, and no transfer that could
 * still be mined by expiresHeight.
 */
export function evaluate(input: Invoice, at: { now: number; chainHeight: number }): Evaluation {
	const inv: Invoice = structuredClone(input);
	const events: InvoiceEvent[] = [];
	if (inv.adminFinal) return { invoice: inv, events, changed: false };
	const { now, chainHeight } = at;
	const before = inv.status;
	const wasPending = Boolean(inv.pendingExpiry);
	const snapshot = JSON.stringify(input);

	if (before === "settled") {
		const t = totals(inv);
		if (t.received < t.threshold) {
			// The counted money is gone (double-spent in a reorg, or flagged): review and alert at once.
			inv.status = "review";
			inv.reviewReason = "reversed";
			delete inv.reconfirmingSince;
			events.push({ type: "alert", kind: "reversed" });
		} else if (t.depth < inv.required) {
			// A reorg knocked it shallower, but the money is still there: stay settled, re-confirm quietly.
			if (inv.reconfirmingSince === undefined) {
				inv.reconfirmingSince = chainHeight;
				events.push({ type: "reconfirming" });
			}
			const unmined = inv.transfers.some((x) => counted(x) && x.height === 0);
			if (unmined && chainHeight - inv.reconfirmingSince >= RECONFIRM_BLOCKS) {
				inv.status = "review";
				inv.reviewReason = "reorg";
				delete inv.reconfirmingSince;
				events.push({ type: "alert", kind: "reorg" });
			}
		} else if (inv.reconfirmingSince !== undefined) {
			delete inv.reconfirmingSince;
			events.push({ type: "reconfirmed" });
		}
	} else if (before === "expired") {
		const s = classify(totals(inv, (x) => onTime(inv, x)), inv.required);
		if (s === "confirming" || s === "settled") {
			// Paid in time, reported after expiry: reopen and continue normally.
			inv.status = s;
			inv.reopened = true;
			events.push({ type: "reopened" });
			if (s === "settled") inv.settledAt = now;
			else delete inv.finalAt;
		} else if (hasUndecided(inv, chainHeight)) {
			// Could still prove on time once mined: leave it expired for now and decide on a later sync.
		} else if (hasLate(inv, chainHeight)) {
			inv.status = "review";
			inv.reviewReason = "late";
		} else if (s === "seen" && inv.kind !== "tip") {
			// An on-time partial payment that turned up after expiry: underpaid, not silently expired (2b decision).
			inv.status = "review";
			inv.reviewReason = "underpaid";
		}
	} else if (OPEN_STATUSES.has(before)) {
		const t = basis(inv, now);
		let s: InvoiceStatus = classify(t, inv.required);
		inv.pendingExpiry = false;
		if ((s === "new" || s === "seen") && now >= inv.expiresAt) {
			if (inv.seq < inv.expiresAt || hasUndecided(inv, chainHeight)) {
				// No sync from after the deadline yet, or a payment that may still be mined in time: wait.
				inv.pendingExpiry = true;
			} else if (hasLate(inv, chainHeight)) {
				s = "review";
				inv.reviewReason = "late";
			} else if (s === "seen" && inv.kind !== "tip") {
				s = "review";
				inv.reviewReason = "underpaid";
			} else {
				// Nothing usable (or a tip below the dust floor: phase 07 decides tips under dust).
				s = "expired";
			}
		}
		inv.status = s;
		if (s === "settled") {
			inv.settledAt = now;
			const all = totals(inv);
			if (inv.kind !== "tip" && inv.expectedAtomic !== null && all.received > BigInt(inv.expectedAtomic)) {
				inv.overpaidAtomic = (all.received - BigInt(inv.expectedAtomic)).toString();
			}
		}
	}

	if (!OPEN_STATUSES.has(inv.status)) {
		delete inv.pendingExpiry;
		if (inv.finalAt === undefined) inv.finalAt = now;
	}
	if (inv.status !== before) {
		events.unshift({ type: "status", from: before, to: inv.status, ...(inv.status === "review" ? { reason: inv.reviewReason } : {}) });
	} else if (inv.pendingExpiry && !wasPending) {
		events.push({ type: "pendingExpiry" });
	}
	if (inv.pendingExpiry === false) delete inv.pendingExpiry;
	return { invoice: inv, events, changed: JSON.stringify(inv) !== snapshot };
}

