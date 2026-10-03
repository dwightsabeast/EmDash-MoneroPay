// Spike Q6 on a running site: 20 truly concurrent HTTP claims, repeated over several rounds.
// Usage: node scripts/claim-race.mjs <base URL> [rounds]
const base = process.argv[2];
const rounds = Number(process.argv[3] ?? 10);
if (!base) throw new Error("usage: node scripts/claim-race.mjs <base URL> [rounds]");
const url = (route) => `${base.replace(/\/$/, "")}/_emdash/api/plugins/xmr-spike/${route}`;

async function call(route, body) {
	const res = await fetch(url(route), {
		method: body === undefined ? "GET" : "POST",
		headers: body === undefined ? {} : { "content-type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const json = await res.json();
	if (!json.success) throw new Error(`${route}: ${res.status} ${JSON.stringify(json.error)}`);
	return json.data;
}

let failures = 0;
for (let round = 1; round <= rounds; round++) {
	// One free row, 20 claimers.
	await call("pool-seed", { count: 1 });
	const t0 = Date.now();
	const one = await Promise.all(Array.from({ length: 20 }, (_, i) => call("pool-claim-row", { id: "row-1", claimer: `r${round}c${i}` })));
	const ms1 = Date.now() - t0;
	const winners = one.filter((r) => r.applied);
	const errs1 = one.filter((r) => r.error).map((r) => r.error);
	const rows1 = await call("pool-list");
	const ok1 = winners.length === 1 && rows1.length === 1 && rows1[0].invoiceId === winners[0].row.invoiceId;

	// Five free rows, 20 claimers with the claim loop.
	await call("pool-seed", { count: 5 });
	const t1 = Date.now();
	const any = await Promise.all(Array.from({ length: 20 }, (_, i) => call("pool-claim-any", { claimer: `r${round}a${i}` })));
	const ms2 = Date.now() - t1;
	const claimed = any.map((r) => r.claimed).filter(Boolean);
	const rows2 = await call("pool-list");
	const errs2 = any.flatMap((r) => r.errors);
	const ok2 =
		claimed.length === 5 &&
		new Set(claimed).size === 5 &&
		any.filter((r) => r.code === "NO_ADDRESS_AVAILABLE").length === 15 &&
		rows2.every((r) => r.status === "claimed") &&
		new Set(rows2.map((r) => r.invoiceId)).size === 5;

	if (!ok1 || !ok2) failures++;
	console.log(
		`round ${String(round).padStart(2)}: one-row winners=${winners.length} winner=${winners[0]?.row.invoiceId ?? "-"} errors=${errs1.length} ${ms1}ms | ` +
			`any: claimed=${claimed.length} distinct=${new Set(claimed).size} maxAttempts=${Math.max(...any.map((r) => r.attempts))} errors=${errs2.length} ${ms2}ms ${ok1 && ok2 ? "OK" : "FAIL"}`,
	);
	for (const e of [...new Set([...errs1, ...errs2])]) console.log(`   error seen: ${e}`);
}
console.log(failures === 0 ? `ALL ${rounds} ROUNDS OK` : `${failures} ROUND(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
