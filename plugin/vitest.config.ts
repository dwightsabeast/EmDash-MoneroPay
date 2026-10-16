import { emdashPluginTest } from "@emdash-cms/plugin-test/config";
import { configDefaults, defineConfig } from "vitest/config";

import { GOODS_ENABLED } from "./src/core/constants";

export default defineConfig({
	plugins: [emdashPluginTest()],
	// The release-1 switch as committed (spec change 22). With it off, product-only files run only under
	// vitest.goods.config.ts, which builds a copy with it on.
	define: { __COFFER_GOODS__: String(GOODS_ENABLED) },
	// One worker: the dev box has 8 GB of RAM at most (CLAUDE.md, "Memory"). 20 s a test: each route test starts its own
	// workerd host, and CI runners have run 7x slower than the dev box (runs 37866556943 and 37994601431, where a test
	// taking 0.7 s here passed 5 s).
	test: {
		maxWorkers: 1,
		testTimeout: 20_000,
		exclude: [...configDefaults.exclude, ...(GOODS_ENABLED ? [] : ["tests/routes/checkout-route.test.ts", "tests/routes/admin-invoices.test.ts"])],
	},
});
