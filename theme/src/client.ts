/**
 * The pay page's state, worked out the same way on the server (first render) and in the browser (every poll): the
 * browser script is these two functions' own source text (`CLIENT_SCRIPT`), so there's one copy of the rules, and the
 * CSP hash is computed from the exact text sent. Both functions must stay self-contained: no imports, no references
 * outside their own bodies (tests/client.test.ts runs the script text on its own to check).
 */

export type PayStateName = "waiting" | "partial" | "checking" | "confirming" | "settled" | "reconfirming" | "expired" | "review" | "notfound";

export interface PayView {
	state: PayStateName;
	/** No more polling: nothing will change this page by itself. */
	final: boolean;
	confirmations: number;
	required: number;
	/** XMR received so far, without trailing zeros. */
	received: string;
}

/**
 * From the status route's `data` (the invoice's status, or `{ error: { code } }`) to what the page shows. Null for
 * anything else (a failed request, a reply of the wrong shape): the page keeps what it shows and asks again.
 */
export function payState(data: unknown): PayView | null {
	if (typeof data !== "object" || data === null) return null;
	const d = data as Record<string, any>;
	if (d.error && d.error.code === "INVOICE_NOT_FOUND") return { state: "notfound", final: true, confirmations: 0, required: 0, received: "0" };
	if (typeof d.status !== "string" || typeof d.receivedAtomic !== "string" || !/^\d+$/.test(d.receivedAtomic)) return null;
	const a = BigInt(d.receivedAtomic);
	const unit = BigInt("1000000000000");
	const frac = (a % unit).toString().padStart(12, "0").replace(/0+$/, "");
	const received = frac ? `${a / unit}.${frac}` : `${a / unit}`;
	const confirmations = Number.isSafeInteger(d.confirmations) ? d.confirmations : 0;
	const required = Number.isSafeInteger(d.required) ? d.required : 0;
	const view = (state: PayStateName, final: boolean): PayView => ({ state, final, confirmations, required, received });
	switch (d.status) {
		case "new":
			return view(d.pendingExpiry ? "checking" : "waiting", false);
		case "seen":
			return view(d.pendingExpiry ? "checking" : "partial", false);
		case "confirming":
			return view("confirming", false);
		case "settled":
			return d.reconfirming ? view("reconfirming", false) : view("settled", true);
		case "expired":
			return view("expired", true);
		case "review":
			return view("review", true);
		default:
			return null;
	}
}

/** What the browser needs, passed in so tests can run `clientMain` against fakes. */
export interface ClientEnv {
	document: { querySelector(selector: string): any; hidden?: boolean };
	fetch(url: string, init: { cache: "no-store"; credentials: "same-origin" }): Promise<{ json(): Promise<any> }>;
	setTimeout(fn: () => void, ms: number): unknown;
	now(): number;
	clipboard?: { writeText(text: string): Promise<void> };
}

/**
 * The browser side: polls the status route every 5 s until the state is final (skipping while the tab is hidden),
 * shows the matching sections, keeps the countdown and counters current, and wires the Copy buttons. Without
 * JavaScript, the server-rendered page already shows the right state and nothing here is needed.
 */
export function clientMain(state: typeof payState, env: ClientEnv): void {
	const root = env.document.querySelector("[data-coffer-pay]");
	if (!root) return;
	const url = root.getAttribute("data-status-url");
	const expiresAt = Date.parse(root.getAttribute("data-expires-at") || "");
	let current = root.getAttribute("data-state") || "";
	let final = root.getAttribute("data-final") === "true" || !url;

	const setField = (name: string, text: string) => {
		for (const el of root.querySelectorAll(`[data-field="${name}"]`)) el.textContent = text;
	};
	const apply = (v: PayView) => {
		current = v.state;
		final = v.final;
		root.setAttribute("data-state", v.state);
		for (const el of root.querySelectorAll("[data-show]")) el.hidden = !String(el.getAttribute("data-show")).split(" ").includes(v.state);
		setField("confirmations", String(v.confirmations));
		setField("required", String(v.required));
		setField("received", v.received);
	};
	const tick = () => {
		if (current !== "waiting" && current !== "partial") return;
		const left = Math.max(0, Math.floor((expiresAt - env.now()) / 1000));
		setField("countdown", `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`);
		if (left > 0) env.setTimeout(tick, 1000);
	};
	const poll = async () => {
		if (final) return;
		if (!env.document.hidden) {
			try {
				const reply = await (await env.fetch(url, { cache: "no-store", credentials: "same-origin" })).json();
				const v = reply && reply.success ? state(reply.data) : null;
				if (v) {
					const was = current;
					apply(v);
					if ((v.state === "waiting" || v.state === "partial") && was !== "waiting" && was !== "partial") tick();
				}
			} catch {
				// A network blip: keep what's shown and ask again.
			}
		}
		if (!final) env.setTimeout(poll, 5000);
	};

	for (const button of root.querySelectorAll("[data-copy]")) {
		const source = root.querySelector(`[data-field="${button.getAttribute("data-copy")}"]`);
		if (!source || !env.clipboard) continue;
		button.hidden = false;
		button.addEventListener("click", () => {
			env.clipboard?.writeText(String(source.textContent).trim()).then(
				() => {
					button.textContent = "Copied";
					env.setTimeout(() => (button.textContent = "Copy"), 2000);
				},
				() => undefined,
			);
		});
	}
	tick();
	if (!final) env.setTimeout(poll, 5000);
}

/** The inline script: both functions' source, run once with the browser's own objects. */
export const CLIENT_SCRIPT = `(${clientMain.toString()})(${payState.toString()}, { document, fetch: (u, i) => fetch(u, i), setTimeout: (f, ms) => setTimeout(f, ms), now: () => Date.now(), clipboard: navigator.clipboard });`;
