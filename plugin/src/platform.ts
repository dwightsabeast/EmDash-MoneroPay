/**
 * Release 1 runs on Node-hosted EmDash sites only (spec change 35, B). On Cloudflare Workers, EmDash's sandbox runner
 * counts every bridge call (KV, settings, storage, content, http) toward a fixed 10 per invocation, and pairing alone
 * needs more, so Coffer answers before touching storage instead of failing halfway.
 *
 * Detection: EmDash sets requestMeta.geo only from Cloudflare's `cf` object, which exists only in the Workers runtime
 * (checked on the phase 07 spike site); on Node it's null, even behind Cloudflare's proxy or a tunnel. If an EmDash
 * upgrade ever filled it on Node, every Node site would be refused: tests/routes/platform.test.ts guards that, and
 * docs/emdash-upgrade-checklist.md lists it.
 */
type Block = Record<string, unknown>;

export const UNSUPPORTED_PLATFORM = "UNSUPPORTED_PLATFORM" as const;

export const onCloudflareWorkers = (requestMeta: unknown): boolean => {
	const geo = (requestMeta as { geo?: unknown } | null | undefined)?.geo;
	return geo !== null && geo !== undefined;
};

/** The whole admin page on Cloudflare Workers: one message, no storage read. */
export const unsupportedPage = (): Block[] => [
	{ type: "header", text: "Monero payments" },
	{
		type: "banner",
		variant: "alert",
		title: "Not supported on Cloudflare Workers yet",
		description: "This site runs on Cloudflare Workers. Coffer works on EmDash sites hosted on Node.js; Cloudflare support is planned. Nothing has been set up or stored.",
	},
];
