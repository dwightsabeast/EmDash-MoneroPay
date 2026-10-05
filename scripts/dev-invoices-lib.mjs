// Pure helpers for scripts/dev-invoices.mjs (session 3h). Money is BigInt atomic units (1 XMR = 10^12); no floats.

const ATOMIC_PER_XMR = 10n ** 12n;
/** Stagenet only: a primary address starts with 5, a subaddress with 7; 95 base58 characters. */
const STAGENET_ADDRESS = /^[57][1-9A-HJ-NP-Za-km-z]{94}$/;
const STEP = /^[A-Za-z0-9-]{1,20}$/;

/** Atomic units as an XMR decimal string, for monero-wallet-cli's `transfer`. */
export function atomicToXmr(atomic) {
	if (typeof atomic !== "bigint" || atomic <= 0n) throw new Error("amount must be a positive BigInt");
	const whole = atomic / ATOMIC_PER_XMR;
	const frac = (atomic % ATOMIC_PER_XMR).toString().padStart(12, "0").replace(/0+$/, "");
	return frac ? `${whole}.${frac}` : `${whole}`;
}

/**
 * Part of an invoice's amount: `fraction` is a plain decimal in (0, 1] ("0.6"), rounded down, or "rest" for exactly
 * what is still unpaid (`amountAtomic - paidAtomic`), so the parts of a split payment sum to the amount.
 */
export function partAtomic(amountAtomic, fraction, paidAtomic) {
	const amount = BigInt(amountAtomic);
	const paid = BigInt(paidAtomic);
	if (fraction === "rest") {
		if (paid >= amount) throw new Error("nothing left to pay");
		return amount - paid;
	}
	const m = /^(0|1)(?:\.(\d{1,12}))?$/.exec(fraction);
	if (!m) throw new Error(`fraction must look like 0.6 or 1, got ${fraction}`);
	const digits = m[2] ?? "";
	const num = BigInt(m[1] + digits);
	const den = 10n ** BigInt(digits.length);
	if (num === 0n || num > den) throw new Error(`fraction must be above 0 and at most 1, got ${fraction}`);
	return (amount * num) / den;
}

/**
 * The shell script Wyatt runs to pay: one monero-wallet-cli `transfer` to every destination (one transaction), on
 * stagenet, against the local node. The wallet asks for its password and a confirmation; nothing is read or kept here.
 */
export function payScript(step, payments) {
	if (!STEP.test(step)) throw new Error(`bad step name ${step}`);
	if (payments.length === 0) throw new Error("nothing to pay");
	const comments = [];
	const args = [];
	for (const p of payments) {
		if (!STAGENET_ADDRESS.test(p.address)) throw new Error(`${p.name}: not a stagenet address`);
		const xmr = atomicToXmr(p.atomic);
		comments.push(`# ${p.name}: ${xmr} XMR (${p.atomic} atomic) to ${p.address.slice(0, 12)}…`);
		args.push(p.address, xmr);
	}
	return [
		"#!/bin/sh",
		`# Session 3h, payment step ${step}. Written by scripts/dev-invoices.mjs; run by Wyatt as dev:`,
		`#   sh ~/xmr-pay-dev-data/3h-pay-${step}.sh`,
		"# The wallet asks for its password, then shows the transfer and asks you to confirm.",
		...comments,
		"exec /opt/monero/monero-wallet-cli --stagenet --daemon-address 127.0.0.1:38081 \\",
		'\t--wallet-file "$HOME/stagenet-wallets/buyer" \\',
		`\ttransfer ${args.join(" ")}`,
		"",
	].join("\n");
}
