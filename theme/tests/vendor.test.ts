// The vendored QR encoder is upstream's file at the pinned commit plus three recorded edits, nothing else
// (src/vendor/qrcodegen/SOURCE.md). Any other change fails here until SOURCE.md and these hashes are updated.
import { describe, expect, it } from "vitest";

import vendored from "../src/vendor/qrcodegen/qrcodegen.ts?raw";

const VENDORED_SHA256 = "6021d93ffbcd06e094a1014188a1718384279f684b3bcfbced5784c0cf6e356a";
const UPSTREAM_SHA256 = "1dc03fb5a10e0e2318ea162755bbdb9977ca6ce52cff959e9c9b6deafdccda9c";
const EDITS: Array<[string, string]> = [
	["export namespace qrcodegen {\n", "namespace qrcodegen {\n"],
	["export namespace qrcodegen.QrCode {\n", "namespace qrcodegen.QrCode {\n"],
	["export namespace qrcodegen.QrSegment {\n", "namespace qrcodegen.QrSegment {\n"],
];

async function sha256(text: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

describe("vendored qrcodegen", () => {
	it("matches the hash recorded in SOURCE.md", async () => {
		expect(await sha256(vendored)).toBe(VENDORED_SHA256);
	});

	it("is upstream's file once the three recorded edits are undone", async () => {
		let upstream = vendored;
		for (const [edited, original] of EDITS) {
			expect(upstream.split(edited)).toHaveLength(2); // each edit exactly once
			upstream = upstream.replace(edited, original);
		}
		expect(await sha256(upstream)).toBe(UPSTREAM_SHA256);
	});
});
