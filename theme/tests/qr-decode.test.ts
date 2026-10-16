// The QR round trip through an independent decoder: ZBar's zbarimg (CI installs zbar-tools; Wyatt's choice in the
// phase 06 plan). Each symbol is written as a PGM image and must decode to the URI byte for byte. Skipped when zbarimg
// is missing, except with COFFER_REQUIRE_ZBAR=1 (CI), where a missing decoder fails instead.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { QUIET_ZONE, qrModules } from "../src/qr";
import { URIS } from "./uris";

const SCALE = 6;
const have = spawnSync("zbarimg", ["--version"], { encoding: "utf8" }).status === 0;
const required = process.env.COFFER_REQUIRE_ZBAR === "1";
const dir = have ? mkdtempSync(join(tmpdir(), "coffer-qr-")) : "";
afterAll(() => {
	if (dir) rmSync(dir, { recursive: true, force: true });
});

/** A binary PGM (P5): white quiet zone, black modules, SCALE pixels per module. */
function pgm(modules: boolean[][]): Uint8Array {
	const side = (modules.length + 2 * QUIET_ZONE) * SCALE;
	const header = new TextEncoder().encode(`P5\n${side} ${side}\n255\n`);
	const out = new Uint8Array(header.length + side * side).fill(255);
	out.set(header, 0);
	modules.forEach((row, y) =>
		row.forEach((on, x) => {
			if (!on) return;
			for (let dy = 0; dy < SCALE; dy++)
				for (let dx = 0; dx < SCALE; dx++) out[header.length + ((y + QUIET_ZONE) * SCALE + dy) * side + (x + QUIET_ZONE) * SCALE + dx] = 0;
		}),
	);
	return out;
}

describe("QR round trip through zbarimg", () => {
	it.runIf(required && !have)("zbarimg is installed (COFFER_REQUIRE_ZBAR=1)", () => {
		expect.fail("COFFER_REQUIRE_ZBAR=1 but zbarimg isn't on the PATH: install zbar-tools");
	});

	for (const [name, uri] of Object.entries(URIS)) {
		it.runIf(have)(`${name} decodes to the exact URI`, () => {
			const file = join(dir, `${name}.pgm`);
			writeFileSync(file, pgm(qrModules(uri)));
			const r = spawnSync("zbarimg", ["--raw", "-q", "-Sdisable", "-Sqrcode.enable", file], { encoding: "utf8" });
			expect(r.status, r.stderr).toBe(0);
			expect(r.stdout).toBe(`${uri}\n`);
		});
	}
});
