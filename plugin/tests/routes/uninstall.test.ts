// plugin:uninstall with deleteData removes everything xmr-pay stored. Tested against a minimal fake context: the test
// hosts can't both seed this state and invoke uninstall, so this covers the logic, not the host's wiring.
import { expect, it } from "vitest";

import { deletePluginData } from "../../src/store";

function fakeCtx() {
	const cols: Record<string, Map<string, unknown>> = { pool: new Map(), invoices: new Map() };
	for (let i = 1; i <= 230; i++) cols.pool.set(String(i), { addrIndex: i });
	for (let i = 1; i <= 7; i++) cols.invoices.set(`inv_${i}`, { id: `inv_${i}` });
	const kv = new Map<string, unknown>([["state:pairing", {}], ["state:bridge", {}], ["state:alerts", []], ["unrelated", 1]]);
	const settings = new Map<string, unknown>([["bridgePublicKey", "k"], ["currency", "USD"], ["speed", "fast"]]);
	const collection = (m: Map<string, unknown>) => ({
		async query({ limit }: { limit: number }) {
			const items = [...m.entries()].slice(0, limit).map(([id, data]) => ({ id, data }));
			return { items, hasMore: m.size > limit };
		},
		async deleteMany(ids: string[]) {
			for (const id of ids) m.delete(id);
			return ids.length;
		},
	});
	const ctx = {
		storage: { pool: collection(cols.pool), invoices: collection(cols.invoices) },
		kv: { delete: async (k: string) => kv.delete(k) },
		settings: { delete: async (k: string) => settings.delete(k) },
	};
	return { ctx, cols, kv, settings };
}

it("deletes the pool (across pages), the invoices, xmr-pay's KV state and its settings", async () => {
	const f = fakeCtx();
	await deletePluginData(f.ctx as never);
	expect(f.cols.pool.size).toBe(0);
	expect(f.cols.invoices.size).toBe(0);
	expect([...f.kv.keys()]).toEqual(["unrelated"]);
	expect(f.settings.size).toBe(0);
});
