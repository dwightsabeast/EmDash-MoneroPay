// Tests for the pure parts of scripts/dev-invoices.mjs (session 3h). Run: node --test scripts/*.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import { atomicToXmr, partAtomic, payScript } from "./dev-invoices-lib.mjs";

test("atomicToXmr: 12 decimals, trailing zeros trimmed, no floats", () => {
	assert.equal(atomicToXmr(1_000_000_000_000n), "1");
	assert.equal(atomicToXmr(1n), "0.000000000001");
	assert.equal(atomicToXmr(3_456_789_012_345n), "3.456789012345");
	assert.equal(atomicToXmr(2_500_000_000n), "0.0025");
	assert.equal(atomicToXmr(123_456_789_012_345_678_901n), "123456789.012345678901");
	assert.throws(() => atomicToXmr(0n));
	assert.throws(() => atomicToXmr(-1n));
});

test("partAtomic: a decimal fraction of the amount, rounded down", () => {
	assert.equal(partAtomic("1000", "0.6", "0"), 600n);
	assert.equal(partAtomic("1001", "0.6", "0"), 600n); // floor(600.6)
	assert.equal(partAtomic("1000", "0.9", "0"), 900n);
	assert.equal(partAtomic("1000", "1", "0"), 1000n);
	assert.equal(partAtomic("7953218667", "0.9", "0"), 7157896800n);
	assert.throws(() => partAtomic("1000", "1.5", "0"));
	assert.throws(() => partAtomic("1000", "0", "0"));
	assert.throws(() => partAtomic("1000", ".6", "0"));
	assert.throws(() => partAtomic("1000", "6e-1", "0"));
});

test("partAtomic: rest pays exactly what's left, so parts sum to the amount", () => {
	const amount = "7953218667";
	const first = partAtomic(amount, "0.6", "0");
	const rest = partAtomic(amount, "rest", first.toString());
	assert.equal(first + rest, 7953218667n);
	assert.throws(() => partAtomic("1000", "rest", "1000")); // nothing left
});

test("payScript: one transfer to every destination, wallet path from $HOME, nothing else", () => {
	const a = "5" + "A".repeat(94);
	const b = "7" + "B".repeat(94);
	const s = payScript("A", [
		{ name: "happy", address: a, atomic: 1_000_000_000n },
		{ name: "two-part", address: b, atomic: 600_000_000n },
	]);
	assert.match(s, /^#!\/bin\/sh\n/);
	assert.ok(s.includes(`transfer ${a} 0.001 ${b} 0.0006\n`));
	assert.ok(s.includes('--wallet-file "$HOME/stagenet-wallets/buyer"'));
	assert.ok(s.includes("--stagenet"));
	assert.ok(s.includes("--daemon-address 127.0.0.1:38081"));
	assert.ok(!/mainnet|--testnet/.test(s));
	assert.ok(s.includes("# happy: 0.001 XMR"));
});

test("payScript: refuses anything that isn't a stagenet address", () => {
	assert.throws(() => payScript("A", [{ name: "x", address: "4" + "A".repeat(94), atomic: 1n }])); // mainnet prefix
	assert.throws(() => payScript("A", [{ name: "x", address: "5" + "A".repeat(93), atomic: 1n }])); // too short
	assert.throws(() => payScript("A", [{ name: "x", address: "5" + "A".repeat(93) + "0", atomic: 1n }])); // not base58
	assert.throws(() => payScript("A; rm", [{ name: "x", address: "5" + "A".repeat(94), atomic: 1n }])); // step name
	assert.throws(() => payScript("A", []));
});
