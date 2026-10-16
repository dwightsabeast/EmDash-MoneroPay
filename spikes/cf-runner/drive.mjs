// THROWAWAY driver (spikes/cf-runner/PLAN.md): asks the limits plugin on the deployed spike site to repeat each kind of
// operation 12 times and reports how many succeeded before the runner refused, plus CPU thresholds. Prints a table;
// results go to ~/xmr-pay-dev-data/cf-spike/ by redirecting stdout. Usage: node spikes/cf-runner/drive.mjs <site origin>
const origin = process.argv[2];
if (!/^https:\/\/xmr-cf-spike\.[a-z0-9-]+\.workers\.dev$/.test(origin ?? "")) throw new Error("usage: drive.mjs https://xmr-cf-spike.<subdomain>.workers.dev");
const op = async (q) => {
	const res = await fetch(`${origin}/_emdash/api/plugins/cf-limits/op?${new URLSearchParams(q)}`);
	const text = await res.text();
	try {
		const j = JSON.parse(text);
		return { http: res.status, ...(j.data ?? { error: j.error?.message ?? text.slice(0, 200) }) };
	} catch {
		return { http: res.status, error: text.slice(0, 200) };
	}
};
const line = (label, r) => console.log(`${label.padEnd(28)} http ${r.http}  done ${String(r.done ?? "-").padStart(3)}  ${r.ok === false ? "REFUSED" : r.ok ? "ok" : ""}  wall ${r.wallMs ?? "-"} ms  ${r.error ? r.error.slice(0, 90) : ""}`);

console.log("## Bridge calls per invocation (each kind repeated 12 times)");
for (const kind of ["kv", "kvset", "settings", "get", "put", "query", "content", "fetch"]) line(`${kind} x12`, await op({ kind, n: "12" }));
console.log("\n## CPU (integer loop; a refusal here is the 50 ms CPU limit)");
for (const iters of ["1000000", "5000000", "10000000", "20000000", "40000000"]) line(`cpu ${iters}`, await op({ kind: "cpu", iters }));
