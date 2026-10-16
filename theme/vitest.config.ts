/// <reference types="vitest/config" />
import { getViteConfig } from "astro/config";

// Astro's Vite config, so tests can render .astro components through the container API.
export default getViteConfig(
	{
		// One worker: the dev box has 8 GB of RAM at most (CLAUDE.md, "Memory"). 20 s a test, as in plugin/: CI runners
		// have run 7x slower than the dev box.
		test: { maxWorkers: 1, testTimeout: 20_000 },
	},
	// No dev toolbar, so no data-astro-source-* annotations: tests see the HTML a built site sends.
	{ devToolbar: { enabled: false } },
);
