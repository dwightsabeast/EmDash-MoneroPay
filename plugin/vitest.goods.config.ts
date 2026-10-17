/**
 * The plugin's tests with the release-1 switch ON (GOODS_ENABLED = true; spec change 22), so release 2 starts from
 * tested product checkout. The test host builds the plugin from a folder, so this copies the plugin into
 * node_modules/.cache/coffer-goods with the one constant flipped, and builds that. `pnpm test` runs the default config
 * (the switch as committed) and then this one.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { emdashPluginTest } from "@emdash-cms/plugin-test/config";
import { defineConfig } from "vitest/config";

const root = resolve(".");
const copy = join(root, "node_modules/.cache/coffer-goods");
rmSync(copy, { recursive: true, force: true });
mkdirSync(copy, { recursive: true });
for (const f of ["src", "docs", "emdash-plugin.jsonc", "package.json", "tsconfig.json", "README.md"]) if (existsSync(f)) cpSync(f, join(copy, f), { recursive: true });
symlinkSync(join(root, "node_modules"), join(copy, "node_modules"), "dir");
const constants = join(copy, "src/core/constants.ts");
const LINE = /^export const GOODS_ENABLED = (true|false);$/m;
const text = readFileSync(constants, "utf8");
if (!LINE.test(text)) throw new Error("vitest.goods.config.ts: GOODS_ENABLED's line not found in src/core/constants.ts");
writeFileSync(constants, text.replace(LINE, "export const GOODS_ENABLED = true;"));

export default defineConfig({
	plugins: [emdashPluginTest({ dir: copy })],
	define: { __COFFER_GOODS__: "true" },
	test: {
		// The files whose behavior depends on the switch: product checkout, All invoices, and the parts that mention it.
		include: ["tests/routes/checkout-route.test.ts", "tests/routes/admin-invoices.test.ts", "tests/routes/admin-review.test.ts", "tests/routes/admin-layout.test.ts", "tests/routes/admin-health.test.ts", "tests/routes/release1.test.ts"],
		maxWorkers: 1,
		testTimeout: 20_000,
	},
});
