// The pool claim loop when the database refuses an invoice (spec change 3: `subaddress` is unique on invoices). Tested
// against a minimal fake context because the runtime test host doesn't apply `uniqueIndexes`; on a real site EmDash
// creates a UNIQUE index on json_extract(data, '$.subaddress'), and the 2f close entry in docs/progress.md shows it refusing a duplicate.
import { expect, it } from "vitest";

import { claimAndStore } from "../../src/checkout";
import type { Invoice } from "../../src/core/invoice";

const ADDR = (i: number) => `7${String(i).padStart(94, "B")}`;

function fakeCtx(freeRows: number, takenAddresses: string[]) {
	const pool = new Map<string, { addrIndex: number; address: string; status: string; invoiceId?: string }>();
	for (let i = 1; i <= freeRows; i++) pool.set(String(i), { addrIndex: i, address: ADDR(i), status: "free" });
	const invoices = new Map<string, { subaddress: string }>(takenAddresses.map((a, n) => [`inv_old${n}`, { subaddress: a }]));
	const ctx = {
		storage: {
			pool: {
				async query() {
					const items = [...pool.entries()].filter(([, r]) => r.status === "free").sort(([, a], [, b]) => a.addrIndex - b.addrIndex).slice(0, 5).map(([id, data]) => ({ id, data }));
					return { items, hasMore: false };
				},
				async updateIf(id: string, { set }: { set: { status: string; invoiceId: string } }) {
					const row = pool.get(id);
					if (!row || row.status !== "free") return { applied: false };
					Object.assign(row, set);
					return { applied: true };
				},
			},
			invoices: {
				async put(id: string, inv: { subaddress: string }) {
					if ([...invoices.values()].some((i) => i.subaddress === inv.subaddress)) throw new Error("UNIQUE constraint failed");
					invoices.set(id, inv);
				},
			},
		},
	};
	return { ctx, pool, invoices };
}

const build = (row: { addrIndex: number; address: string }) => ({ id: `inv_${row.addrIndex}`, subaddress: row.address, addrIndex: row.addrIndex }) as unknown as Invoice;

it("an address already on an invoice is refused; the row stays claimed and checkout uses another free one", async () => {
	const f = fakeCtx(3, [ADDR(1)]);
	const inv = await claimAndStore(f.ctx as never, build);
	expect(inv).not.toBeNull();
	expect(inv?.subaddress).not.toBe(ADDR(1));
	expect(f.pool.get("1")).toMatchObject({ status: "claimed" }); // never handed out again
	expect(f.pool.get(String(inv?.addrIndex))).toMatchObject({ status: "claimed", invoiceId: inv?.id });
	expect([...f.invoices.values()].filter((i) => i.subaddress === ADDR(1))).toHaveLength(1);
});

it("NO_ADDRESS_AVAILABLE (null) when every free address is already used", async () => {
	const f = fakeCtx(2, [ADDR(1), ADDR(2)]);
	expect(await claimAndStore(f.ctx as never, build)).toBeNull();
	expect([...f.pool.values()].every((r) => r.status === "claimed")).toBe(true);
});
