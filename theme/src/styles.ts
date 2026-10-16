/**
 * The pay page's own CSS, inlined and allowed by its hash in the CSP. A theme restyles it through the `--coffer-*`
 * custom properties (or its own stylesheet from the same origin, through PayPage's `head` slot); no fonts or images
 * are loaded from anywhere.
 */
export const PAGE_CSS = `
:root {
	--coffer-bg: #fafaf9; --coffer-fg: #1c1917; --coffer-muted: #57534e; --coffer-border: #d6d3d1;
	--coffer-surface: #ffffff; --coffer-accent: #c2410c; --coffer-ok: #15803d; --coffer-warn: #a16207;
	--coffer-radius: 12px; --coffer-font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
	--coffer-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
	--coffer-qr-dark: #000; --coffer-qr-light: #fff; --coffer-width: 28rem;
	color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
	:root { --coffer-bg: #1c1917; --coffer-fg: #f5f5f4; --coffer-muted: #a8a29e; --coffer-border: #44403c; --coffer-surface: #292524; --coffer-accent: #fb923c; --coffer-ok: #4ade80; --coffer-warn: #facc15; }
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; background: var(--coffer-bg); color: var(--coffer-fg); font: 16px/1.5 var(--coffer-font); }
.coffer-pay { max-width: var(--coffer-width); margin: 0 auto; padding: 2rem 1rem 3rem; }
.coffer-pay h1 { font-size: 1.375rem; margin: 0 0 1rem; }
.coffer-card { background: var(--coffer-surface); border: 1px solid var(--coffer-border); border-radius: var(--coffer-radius); padding: 1.25rem; margin: 0 0 1rem; }
.coffer-amount { font-size: 1.75rem; font-weight: 650; margin: 0; overflow-wrap: anywhere; }
.coffer-fiat, .coffer-note { color: var(--coffer-muted); margin: 0.25rem 0 0; }
.coffer-qr { display: block; width: 100%; max-width: 18rem; height: auto; margin: 0 auto 1rem; border-radius: 6px; }
.coffer-qr-dark { fill: var(--coffer-qr-dark); }
.coffer-qr-light { fill: var(--coffer-qr-light); }
.coffer-label { font-size: 0.875rem; color: var(--coffer-muted); margin: 0 0 0.25rem; }
.coffer-copyrow { display: flex; gap: 0.5rem; align-items: flex-start; }
.coffer-value { flex: 1; min-width: 0; font: 0.875rem/1.4 var(--coffer-mono); overflow-wrap: anywhere; background: var(--coffer-bg); border: 1px solid var(--coffer-border); border-radius: 6px; padding: 0.5rem; margin: 0; user-select: all; }
.coffer-button, .coffer-wallet { font: inherit; font-size: 0.875rem; border-radius: 6px; padding: 0.5rem 0.75rem; cursor: pointer; }
.coffer-button { background: var(--coffer-surface); color: var(--coffer-fg); border: 1px solid var(--coffer-border); }
.coffer-wallet { display: block; text-align: center; margin-top: 1rem; background: var(--coffer-accent); color: #fff; text-decoration: none; font-weight: 600; }
.coffer-status { font-size: 1.0625rem; margin: 0; }
.coffer-status strong { font-variant-numeric: tabular-nums; }
.coffer-pay[data-state="settled"] .coffer-status, .coffer-pay[data-state="reconfirming"] .coffer-status { color: var(--coffer-ok); }
.coffer-pay[data-state="expired"] .coffer-status, .coffer-pay[data-state="review"] .coffer-status { color: var(--coffer-warn); }
`;
