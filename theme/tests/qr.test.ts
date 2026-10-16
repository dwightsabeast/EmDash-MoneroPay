// QR codes for monero: URIs: byte mode, error correction M, rendered as inline SVG with a quiet zone (phase 06).
import { describe, expect, it } from "vitest";

import { QUIET_ZONE, qrModules, qrSvg } from "../src/qr";
import { URIS } from "./uris";

describe("qrModules", () => {
	it("a square symbol of a valid size for every test URI", () => {
		for (const uri of Object.values(URIS)) {
			const m = qrModules(uri);
			expect(m.length).toBeGreaterThanOrEqual(21);
			expect((m.length - 17) % 4).toBe(0); // 17 + 4 × version
			for (const row of m) expect(row).toHaveLength(m.length);
		}
	});

	it("the three finder patterns are where the standard puts them", () => {
		const m = qrModules(URIS.product);
		const n = m.length;
		const finder = (x0: number, y0: number) => {
			for (let y = 0; y < 7; y++)
				for (let x = 0; x < 7; x++) {
					const ring = Math.max(Math.abs(x - 3), Math.abs(y - 3));
					expect(m[y0 + y][x0 + x], `module ${x0 + x},${y0 + y}`).toBe(ring !== 2);
				}
		};
		finder(0, 0);
		finder(n - 7, 0);
		finder(0, n - 7);
	});

	it("deterministic: the same URI gives the same symbol", () => {
		expect(qrModules(URIS.awkwardTitle)).toEqual(qrModules(URIS.awkwardTitle));
	});
});

describe("qrSvg", () => {
	it("one path of dark modules over a light background, with the quiet zone, and nothing external", () => {
		const svg = qrSvg(URIS.product);
		const n = qrModules(URIS.product).length + 2 * QUIET_ZONE;
		expect(svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}"`)).toBe(true);
		expect(svg.match(/<path /g)).toHaveLength(1);
		expect(svg.match(/<rect /g)).toHaveLength(1);
		expect(svg).toContain('shape-rendering="crispEdges"');
		// No URL but the SVG namespace, no style attribute (the pay page's CSP has no 'unsafe-inline'), no script.
		expect(svg.replace('xmlns="http://www.w3.org/2000/svg"', "")).not.toMatch(/https?:|href|style=|<script|url\(/i);
		// The URI itself isn't in the markup: the symbol carries it.
		expect(svg).not.toContain("monero:");
	});

	it("the path draws exactly the dark modules, offset by the quiet zone", () => {
		const m = qrModules(URIS.testTip);
		const d = /<path [^>]*d="([^"]+)"/.exec(qrSvg(URIS.testTip))?.[1] ?? "";
		const drawn = new Set<string>();
		for (const [, x, y, w] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g))
			for (let i = 0; i < Number(w); i++) drawn.add(`${Number(x) + i - QUIET_ZONE},${Number(y) - QUIET_ZONE}`);
		const dark = new Set<string>();
		m.forEach((row, y) => row.forEach((on, x) => on && dark.add(`${x},${y}`)));
		expect(drawn).toEqual(dark);
	});

	it("colors through classes that a page can restyle; plain black on white without CSS", () => {
		const svg = qrSvg(URIS.product);
		expect(svg).toMatch(/<rect class="coffer-qr-light" [^>]*fill="#fff"/);
		expect(svg).toMatch(/<path class="coffer-qr-dark" [^>]*fill="#000"/);
		expect(svg).toContain('class="coffer-qr"');
		expect(svg).toContain('role="img"');
		expect(svg).toContain('aria-label="QR code of the payment link"');
	});
});
