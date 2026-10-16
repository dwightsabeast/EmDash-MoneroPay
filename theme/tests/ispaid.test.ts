// isPaid: settled only, read on the server; and the buyer-facing checkout messages.
import { describe, expect, it } from "vitest";

import { isPaid } from "../src/isPaid";
import { checkoutErrorMessage } from "../src/messages";
import { type Call, NOT_FOUND, TOKEN, locals, ok, status } from "./fixtures";

const astro = (loc: unknown) => ({ locals: loc, url: new URL("https://shop.example/members") });

describe("isPaid", () => {
	it("true only for settled (also while reconfirming after a reorg)", async () => {
		expect(await isPaid(astro(locals(ok(status({ status: "settled" })))), TOKEN)).toBe(true);
		expect(await isPaid(astro(locals(ok(status({ status: "settled", reconfirming: true })))), TOKEN)).toBe(true);
		for (const s of ["new", "seen", "confirming", "expired", "review"] as const) expect(await isPaid(astro(locals(ok(status({ status: s })))), TOKEN), s).toBe(false);
	});

	it("false for an unknown or malformed token, no runtime, or a failing plugin; a malformed token isn't sent", async () => {
		expect(await isPaid(astro(locals(NOT_FOUND)), TOKEN)).toBe(false);
		expect(await isPaid(astro({}), TOKEN)).toBe(false);
		expect(await isPaid(astro(locals(null, [], { throws: true })), TOKEN)).toBe(false);
		const calls: Call[] = [];
		for (const bad of [null, 42, "", "x".repeat(22) + "?", { toString: () => TOKEN }]) expect(await isPaid(astro(locals(ok(status({ status: "settled" })), calls)), bad)).toBe(false);
		expect(calls).toEqual([]);
	});
});

describe("checkoutErrorMessage", () => {
	it("a silent wallet host and a syncing node read the same (spec change 20, item 5); unknown codes get a general line", () => {
		expect(checkoutErrorMessage("WALLET_HOST_SYNCING")).toBe(checkoutErrorMessage("WALLET_HOST_SILENT"));
		expect(checkoutErrorMessage("RATE_UNAVAILABLE")).toContain("price");
		expect(checkoutErrorMessage("toString")).toBe("Monero payment isn't available right now. Please try again later.");
		expect(checkoutErrorMessage(undefined)).toBe("Monero payment isn't available right now. Please try again later.");
	});
});
