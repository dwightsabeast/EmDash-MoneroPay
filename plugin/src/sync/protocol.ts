/**
 * The bridge/sync wire protocol (docs/spec.md, API contracts, `POST bridge/sync`): header checks, Ed25519 verification
 * over the exact bytes, strict UTF-8 decoding, and hand-written validation of the body. No storage here.
 */

/** The bridge protocol version this plugin speaks. It also accepts the previous one (and flags it as outdated). */
export const PROTOCOL_VERSION = 1;
/** x-xmr-ts must be within this many seconds of the server clock. */
export const TS_WINDOW_S = 300;
/** Declared as the route's maxBytes; the bridge splits anything bigger across syncs. */
export const MAX_BODY_BYTES = 256 * 1024;
/** The pairing path parses the body before verifying it, so only for small bodies. */
export const PAIR_MAX_BYTES = 4096;
export const MAX_ADDRESSES = 100;
export const MAX_SNAPSHOTS = 100;
export const MAX_TRANSFERS = 32;
/** The pool size the bridge tops up to. */
export const POOL_TARGET = 50;

export type SyncErrorCode =
	| "NOT_PAIRED"
	| "MISSING_SIGNATURE"
	| "STALE_TIMESTAMP"
	| "BAD_SIGNATURE"
	| "INVALID_ENCODING"
	| "INVALID_BODY"
	| "UNSUPPORTED_VERSION"
	| "PAIRING_NOT_ACTIVE"
	| "PAIRING_REJECTED";

export type Result<T> = { ok: true; value: T } | { ok: false; code: SyncErrorCode };
const fail = (code: SyncErrorCode): { ok: false; code: SyncErrorCode } => ({ ok: false, code });

const B64_32 = /^[A-Za-z0-9+/]{43}=$/;
const B64_64 = /^[A-Za-z0-9+/]{86}==$/;

/** Standard padded base64 of exactly 32 (public key) or 64 (signature) bytes; anything else is null. */
export function decodeBase64(text: string, bytes: 32 | 64): Uint8Array<ArrayBuffer> | null {
	if (!(bytes === 32 ? B64_32 : B64_64).test(text)) return null;
	const bin = atob(text);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out.length === bytes ? out : null;
}

export interface SignedHeaders {
	ts: string;
	signature: Uint8Array<ArrayBuffer>;
}

/** Both headers present and well formed, and the timestamp fresh. Header names arrive lowercased. */
export function checkHeaders(headers: Record<string, string>, nowMs: number): Result<SignedHeaders> {
	const ts = headers["x-xmr-ts"];
	const sig = headers["x-xmr-sig"];
	if (ts === undefined || sig === undefined || !/^\d{1,12}$/.test(ts)) return fail("MISSING_SIGNATURE");
	const signature = decodeBase64(sig, 64);
	if (!signature) return fail("MISSING_SIGNATURE");
	if (Math.abs(Math.floor(nowMs / 1000) - Number(ts)) > TS_WINDOW_S) return fail("STALE_TIMESTAMP");
	return { ok: true, value: { ts, signature } };
}

/** Ed25519 over ts + "\n" + the exact body bytes, with WebCrypto. */
export async function verifySignature(publicKey: Uint8Array<ArrayBuffer>, ts: string, body: Uint8Array, signature: Uint8Array<ArrayBuffer>): Promise<boolean> {
	const prefix = new TextEncoder().encode(`${ts}\n`);
	const message = new Uint8Array(prefix.length + body.length);
	message.set(prefix, 0);
	message.set(body, prefix.length);
	try {
		const key = await crypto.subtle.importKey("raw", publicKey, { name: "Ed25519" }, false, ["verify"]);
		return await crypto.subtle.verify({ name: "Ed25519" }, key, signature, message);
	} catch {
		return false;
	}
}

/** Strict UTF-8: invalid sequences and a leading byte-order mark are refused (null). */
export function decodeStrict(bytes: Uint8Array): string | null {
	if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return null;
	try {
		return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
	} catch {
		return null;
	}
}

export interface RawTransfer {
	txid: string;
	amount: string;
	confirmations: number;
	height: number;
	timestamp: number;
	doubleSpendSeen: boolean;
	unlockTime: string;
}

/** The wallet host's own checks, shown on the admin page (spec change 13 and the phase 04 wallet-height check). */
export interface BridgeChecks {
	node?: { state: "off" | "ok" | "unavailable" | "mismatch"; detail?: string };
	wallet?: { state: "ok" | "behind" | "unavailable"; detail?: string };
}

export interface SyncBody {
	v: number;
	seq: number;
	height: number;
	addresses: Array<{ index: number; address: string }>;
	snapshots: Array<{ index: number; transfers: RawTransfer[] }>;
	pair?: { code: string; publicKey: string };
	checks?: BridgeChecks;
	/** True when the bridge speaks the previous protocol version: the admin page shows "wallet host update available". */
	outdated: boolean;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const nonNegInt = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const DIGITS_20 = /^\d{1,20}$/;
const TXID = /^[0-9a-f]{64}$/;
/** A Monero subaddress: 95 base58 characters (the bridge checks the network). */
const SUBADDRESS = /^[1-9A-HJ-NP-Za-km-z]{95}$/;
export const PAIRING_CODE = /^[A-Za-z0-9_-]{22}$/;

/** Current, or the previous version when there is one. */
export const acceptsVersion = (v: number, current: number = PROTOCOL_VERSION) => v === current || (v === current - 1 && v >= 1);

function parseTransfer(t: unknown): RawTransfer | null {
	if (!isObject(t)) return null;
	if (typeof t.txid !== "string" || !TXID.test(t.txid)) return null;
	if (typeof t.amount !== "string" || !DIGITS_20.test(t.amount)) return null;
	if (typeof t.unlockTime !== "string" || !DIGITS_20.test(t.unlockTime)) return null;
	if (!nonNegInt(t.confirmations) || !nonNegInt(t.height) || !nonNegInt(t.timestamp)) return null;
	if (typeof t.doubleSpendSeen !== "boolean") return null;
	return {
		txid: t.txid, amount: t.amount, confirmations: t.confirmations, height: t.height, timestamp: t.timestamp,
		doubleSpendSeen: t.doubleSpendSeen, unlockTime: t.unlockTime,
	};
}

const NODE_STATES: ReadonlySet<string> = new Set(["off", "ok", "unavailable", "mismatch"]);
const WALLET_STATES: ReadonlySet<string> = new Set(["ok", "behind", "unavailable"]);
const MAX_DETAIL = 300;

function parseCheck<S extends string>(c: unknown, states: ReadonlySet<string>): { state: S; detail?: string } | undefined {
	if (!isObject(c) || typeof c.state !== "string" || !states.has(c.state)) return undefined;
	return { state: c.state as S, ...(typeof c.detail === "string" ? { detail: c.detail.slice(0, MAX_DETAIL) } : {}) };
}

/** Checks are information for the admin page: anything malformed is dropped, never a reason to refuse the body. */
function parseChecks(c: unknown): BridgeChecks | undefined {
	if (!isObject(c)) return undefined;
	const node = parseCheck<NonNullable<BridgeChecks["node"]>["state"]>(c.node, NODE_STATES);
	const wallet = parseCheck<NonNullable<BridgeChecks["wallet"]>["state"]>(c.wallet, WALLET_STATES);
	if (!node && !wallet) return undefined;
	return { ...(node ? { node } : {}), ...(wallet ? { wallet } : {}) };
}

/**
 * Validates a decoded body. A malformed transfer rejects the whole body (dropping it would read as a vanished payment);
 * malformed or duplicate pool addresses are skipped later instead, since skipping one costs nothing.
 */
export function parseSyncBody(text: string, current: number = PROTOCOL_VERSION): Result<SyncBody> {
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		return fail("INVALID_BODY");
	}
	if (!isObject(json)) return fail("INVALID_BODY");
	if (!Number.isSafeInteger(json.v)) return fail("INVALID_BODY");
	if (!acceptsVersion(json.v as number, current)) return fail("UNSUPPORTED_VERSION");
	if (!Number.isSafeInteger(json.seq) || (json.seq as number) <= 0 || !nonNegInt(json.height)) return fail("INVALID_BODY");
	if (!Array.isArray(json.addresses) || json.addresses.length > MAX_ADDRESSES) return fail("INVALID_BODY");
	if (!Array.isArray(json.snapshots) || json.snapshots.length > MAX_SNAPSHOTS) return fail("INVALID_BODY");

	const addresses: SyncBody["addresses"] = [];
	for (const a of json.addresses) {
		if (isObject(a) && Number.isSafeInteger(a.index) && (a.index as number) >= 1 && typeof a.address === "string" && SUBADDRESS.test(a.address)) {
			addresses.push({ index: a.index as number, address: a.address });
		}
	}

	const snapshots: SyncBody["snapshots"] = [];
	const seenIndexes = new Set<number>();
	for (const s of json.snapshots) {
		if (!isObject(s) || !Number.isSafeInteger(s.index) || (s.index as number) < 1 || seenIndexes.has(s.index as number)) return fail("INVALID_BODY");
		if (!Array.isArray(s.transfers) || s.transfers.length > MAX_TRANSFERS) return fail("INVALID_BODY");
		const transfers: RawTransfer[] = [];
		const txids = new Set<string>();
		for (const raw of s.transfers) {
			const t = parseTransfer(raw);
			if (!t || txids.has(t.txid)) return fail("INVALID_BODY");
			txids.add(t.txid);
			transfers.push(t);
		}
		seenIndexes.add(s.index as number);
		snapshots.push({ index: s.index as number, transfers });
	}

	const body: SyncBody = { v: json.v as number, seq: json.seq as number, height: json.height as number, addresses, snapshots, outdated: (json.v as number) < current };
	const checks = parseChecks(json.checks);
	if (checks) body.checks = checks;
	if (json.pair !== undefined) {
		const p = json.pair;
		if (!isObject(p) || typeof p.code !== "string" || !PAIRING_CODE.test(p.code) || typeof p.publicKey !== "string" || !decodeBase64(p.publicKey, 32)) {
			return fail("INVALID_BODY");
		}
		body.pair = { code: p.code, publicKey: p.publicKey };
	}
	return { ok: true, value: body };
}
