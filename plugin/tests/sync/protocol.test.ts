import { describe, expect, it } from "vitest";

import { MAX_ADDRESSES, MAX_SNAPSHOTS, MAX_TRANSFERS, acceptsVersion, checkHeaders, decodeStrict, parseSyncBody } from "../../src/sync/protocol";

const NOW = 1_790_000_000_000;
const SIG = "A".repeat(86) + "==";
const transfer = (over: Record<string, unknown> = {}) => ({
	txid: "ab".repeat(32), amount: "1000", confirmations: 0, height: 0, timestamp: 1_790_000_000, doubleSpendSeen: false, unlockTime: "0", ...over,
});
const body = (over: Record<string, unknown> = {}) => JSON.stringify({ v: 1, seq: NOW, height: 3_000_000, addresses: [], snapshots: [], ...over });
const code = (r: ReturnType<typeof parseSyncBody>) => (r.ok ? "ok" : r.code);

describe("headers and freshness", () => {
	it("accepts both headers within 300 seconds either way", () => {
		expect(checkHeaders({ "x-xmr-ts": String(NOW / 1000 - 300), "x-xmr-sig": SIG }, NOW).ok).toBe(true);
		expect(checkHeaders({ "x-xmr-ts": String(NOW / 1000 + 300), "x-xmr-sig": SIG }, NOW).ok).toBe(true);
	});
	it("rejects stale and future timestamps", () => {
		expect(checkHeaders({ "x-xmr-ts": String(NOW / 1000 - 301), "x-xmr-sig": SIG }, NOW)).toEqual({ ok: false, code: "STALE_TIMESTAMP" });
		expect(checkHeaders({ "x-xmr-ts": String(NOW / 1000 + 301), "x-xmr-sig": SIG }, NOW)).toEqual({ ok: false, code: "STALE_TIMESTAMP" });
	});
	it("rejects missing or malformed headers", () => {
		for (const h of [{}, { "x-xmr-ts": String(NOW / 1000) }, { "x-xmr-sig": SIG }, { "x-xmr-ts": "17e8", "x-xmr-sig": SIG },
			{ "x-xmr-ts": String(NOW / 1000), "x-xmr-sig": "A".repeat(43) + "=" }, { "x-xmr-ts": String(NOW / 1000), "x-xmr-sig": SIG.replace("==", "") }]) {
			expect(checkHeaders(h as Record<string, string>, NOW)).toEqual({ ok: false, code: "MISSING_SIGNATURE" });
		}
	});
});

describe("strict decoding", () => {
	it("refuses a leading BOM and invalid UTF-8, keeps everything else byte for byte", () => {
		expect(decodeStrict(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]))).toBeNull();
		expect(decodeStrict(new Uint8Array([0x7b, 0xff, 0x7d]))).toBeNull();
		expect(decodeStrict(new TextEncoder().encode("{\"a\":\"café\"}\r\n"))).toBe("{\"a\":\"café\"}\r\n");
	});
});

describe("body validation", () => {
	it("accepts a well-formed body and ignores unknown fields", () => {
		expect(code(parseSyncBody(body({ note: "hi", snapshots: [{ index: 3, transfers: [transfer()] }] })))).toBe("ok");
	});
	it("protocol version: the current and the previous one, the previous flagged as outdated", () => {
		expect(acceptsVersion(1, 1)).toBe(true);
		expect(acceptsVersion(0, 1)).toBe(false);
		expect(acceptsVersion(2, 1)).toBe(false);
		// With a version 2 out, version 1 bridges still work and are flagged.
		const v1 = parseSyncBody(body({ v: 1 }), 2);
		expect(v1.ok && v1.value.outdated).toBe(true);
		expect(code(parseSyncBody(body({ v: 2 }), 2))).toBe("ok");
		expect(code(parseSyncBody(body({ v: 0 }), 2))).toBe("UNSUPPORTED_VERSION");
		expect(code(parseSyncBody(body({ v: 2 })))).toBe("UNSUPPORTED_VERSION");
	});
	it("rejects malformed bodies", () => {
		for (const bad of ["not json", "[]", body({ v: "1" }), body({ seq: 0 }), body({ seq: 1.5 }), body({ height: -1 }), body({ addresses: {} }), body({ snapshots: null })]) {
			expect(code(parseSyncBody(bad))).toBe("INVALID_BODY");
		}
	});
	it("enforces the caps", () => {
		const addr = (i: number) => ({ index: i + 1, address: "7".repeat(95) });
		expect(code(parseSyncBody(body({ addresses: Array.from({ length: MAX_ADDRESSES }, (_, i) => addr(i)) })))).toBe("ok");
		expect(code(parseSyncBody(body({ addresses: Array.from({ length: MAX_ADDRESSES + 1 }, (_, i) => addr(i)) })))).toBe("INVALID_BODY");
		expect(code(parseSyncBody(body({ snapshots: Array.from({ length: MAX_SNAPSHOTS + 1 }, (_, i) => ({ index: i + 1, transfers: [] })) })))).toBe("INVALID_BODY");
		const many = (n: number) => Array.from({ length: n }, (_, i) => transfer({ txid: i.toString(16).padStart(64, "0") }));
		expect(code(parseSyncBody(body({ snapshots: [{ index: 1, transfers: many(MAX_TRANSFERS) }] })))).toBe("ok");
		expect(code(parseSyncBody(body({ snapshots: [{ index: 1, transfers: many(MAX_TRANSFERS + 1) }] })))).toBe("INVALID_BODY");
	});
	it("a malformed transfer rejects the whole body", () => {
		for (const t of [transfer({ amount: 1000 }), transfer({ amount: "1e3" }), transfer({ unlockTime: 0 }), transfer({ txid: "AB".repeat(32) }),
			transfer({ height: -1 }), transfer({ confirmations: 1.5 }), transfer({ doubleSpendSeen: "no" }), transfer({ amount: "1".repeat(21) })]) {
			expect(code(parseSyncBody(body({ snapshots: [{ index: 1, transfers: [t] }] })))).toBe("INVALID_BODY");
		}
		expect(code(parseSyncBody(body({ snapshots: [{ index: 1, transfers: [transfer(), transfer()] }] })))).toBe("INVALID_BODY"); // duplicate txid
		expect(code(parseSyncBody(body({ snapshots: [{ index: 1, transfers: [] }, { index: 1, transfers: [] }] })))).toBe("INVALID_BODY"); // duplicate index
	});
	it("amounts and unlock times up to 20 digits stay strings (no 2^53 limit)", () => {
		const r = parseSyncBody(body({ snapshots: [{ index: 1, transfers: [transfer({ amount: "18446744073709551615", unlockTime: "18446744073709551615" })] }] }));
		expect(r.ok && r.value.snapshots[0].transfers[0]).toMatchObject({ amount: "18446744073709551615", unlockTime: "18446744073709551615" });
	});
	it("skips malformed pool addresses instead of rejecting the body", () => {
		const r = parseSyncBody(body({ addresses: [{ index: 0, address: "7".repeat(95) }, { index: 2, address: "short" }, { index: 3, address: "0".repeat(95) }, { index: 4, address: "7".repeat(95) }] }));
		expect(r.ok && r.value.addresses).toEqual([{ index: 4, address: "7".repeat(95) }]);
	});
	it("validates the pair field", () => {
		expect(code(parseSyncBody(body({ pair: { code: "A".repeat(22), publicKey: "A".repeat(43) + "=" } })))).toBe("ok");
		expect(code(parseSyncBody(body({ pair: { code: "short", publicKey: "A".repeat(43) + "=" } })))).toBe("INVALID_BODY");
		expect(code(parseSyncBody(body({ pair: { code: "A".repeat(22), publicKey: "not base64" } })))).toBe("INVALID_BODY");
	});
});
