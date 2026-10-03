// Spike Q6 in the plugin test host: atomic pool claims with updateIf.
// The real question is the Node runner against the dev site's SQLite (scripts/claim-race.mjs); this is the baseline.
import { afterEach, expect, it } from "vitest";

import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";

let host: PluginRuntimeTestHost | undefined;
afterEach(async () => {
	await host?.dispose();
	host = undefined;
});

async function call(name: string, body?: unknown, method = "POST") {
	const res = await (host as PluginRuntimeTestHost).actions.routes.request(name, {
		method,
		...(body === undefined ? {} : { rawBody: JSON.stringify(body), headers: { "content-type": "application/json" } }),
	});
	return ((await res.json()) as { data: any }).data;
}

it("20 concurrent claims of one free row: exactly one applies", async ({ task }) => {
	host = await createPluginRuntimeTestHost();
	await call("pool-seed", { count: 1 });
	const results = await Promise.all(Array.from({ length: 20 }, (_, i) => call("pool-claim-row", { id: "row-1", claimer: `c${i}` })));
	const winners = results.filter((r) => r.applied);
	const rows = await call("pool-list", undefined, "GET");
	Object.assign(task.meta, { applied: winners.length, errors: results.filter((r) => r.error).map((r) => r.error), rows });
	expect(winners).toHaveLength(1);
	expect(rows).toEqual([expect.objectContaining({ id: "row-1", status: "claimed", invoiceId: winners[0].row.invoiceId })]);
});

it("20 concurrent claim-any requests on 5 free rows: 5 distinct claims, 15 NO_ADDRESS_AVAILABLE", async ({ task }) => {
	host = await createPluginRuntimeTestHost();
	await call("pool-seed", { count: 5 });
	const results = await Promise.all(Array.from({ length: 20 }, (_, i) => call("pool-claim-any", { claimer: `c${i}` })));
	const claimed = results.map((r) => r.claimed).filter(Boolean);
	const rows = await call("pool-list", undefined, "GET");
	Object.assign(task.meta, {
		claimed,
		codes: results.map((r) => r.code ?? "ok"),
		maxAttempts: Math.max(...results.map((r) => r.attempts)),
		errors: results.flatMap((r) => r.errors),
	});
	expect(new Set(claimed).size).toBe(5);
	expect(claimed).toHaveLength(5);
	expect(results.filter((r) => r.code === "NO_ADDRESS_AVAILABLE")).toHaveLength(15);
	expect(rows.every((r: { status: string }) => r.status === "claimed")).toBe(true);
	expect(new Set(rows.map((r: { invoiceId: string }) => r.invoiceId)).size).toBe(5);
});
