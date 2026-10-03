import type { SandboxedPlugin } from "emdash/plugin";

/**
 * xmr-pay: Monero payments for EmDash (docs/spec.md). Session 2a is the scaffold.
 * Routes and hooks arrive in sessions 2c-2e; the trust contract is pinned by tests/manifest.test.ts.
 */

// Block Kit as plain JSON (CLAUDE.md, "Dependency tiers": no @emdash-cms/blocks at runtime).
const PLACEHOLDER_BLOCKS = [
	{ type: "header", text: "Monero payments" },
	{ type: "context", text: "Setup isn't available yet: this plugin is in development (phase 02)." },
];

const plugin: SandboxedPlugin = {
	routes: {
		// The private admin route serves the admin page (/payments) and the xmr-status widget.
		// Session 2e adds settings and Connect wallet host; phase 04 builds the full page.
		admin: {
			methods: ["POST"],
			permission: "plugins:manage",
			handler: async () => ({ blocks: PLACEHOLDER_BLOCKS }),
		},
	},
};

export default plugin;
