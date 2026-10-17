// The store's paging helper (spec change 35, condition 2): page through to the end, under a safety cap, and say when the
// cap cut the scan short. It used to stop silently at 10 pages of 100.
import { describe, expect, it } from "vitest";

import { MAX_SCAN_PAGES, collect } from "../src/store";

function fakeCollection(total: number) {
	const calls: Array<Record<string, unknown>> = [];
	return {
		calls,
		col: {
			async query(opts: { where: unknown; limit: number; cursor?: string }) {
				calls.push(opts as Record<string, unknown>);
				const from = opts.cursor ? Number(opts.cursor) : 0;
				const items = Array.from({ length: Math.max(0, Math.min(opts.limit, total - from)) }, (_, i) => ({ id: `i${from + i}`, data: { id: `i${from + i}` } }));
				const next = from + items.length;
				return { items, hasMore: next < total, cursor: next < total ? String(next) : undefined };
			},
		},
	};
}

describe("collect", () => {
	it("reads every page to the end, well past the old 1,000", async () => {
		const { col, calls } = fakeCollection(2_345);
		const r = await collect(col as never, { status: "x" });
		expect(r.items).toHaveLength(2_345);
		expect(r.truncated).toBe(false);
		expect(calls).toHaveLength(24);
		expect(calls.every((c) => c.limit === 100)).toBe(true);
	});

	it("stops at the safety cap and says so", async () => {
		const { col } = fakeCollection(1_000);
		const r = await collect(col as never, {}, 3);
		expect(r.items).toHaveLength(300);
		expect(r.truncated).toBe(true);
		const exact = await collect(fakeCollection(300).col as never, {}, 3);
		expect(exact).toMatchObject({ truncated: false });
		expect(exact.items).toHaveLength(300);
	});

	it("the cap covers the most the spam cap allows: 40 every 30 minutes, kept 8 days", () => {
		expect(MAX_SCAN_PAGES * 100).toBeGreaterThanOrEqual(40 * 2 * 24 * 8);
	});
});
