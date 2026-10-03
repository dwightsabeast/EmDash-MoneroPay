// Spike Q4: does a sandboxed plugin get ctx.settings with encrypted secret fields (EmDash 1.1.0)?
// The secret is a dummy string; the probe route reports types and lengths, never values.
import { afterEach, expect, it } from "vitest";

import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";

let host: PluginRuntimeTestHost | undefined;
afterEach(async () => {
	await host?.dispose();
	host = undefined;
	delete process.env.EMDASH_ENCRYPTION_KEY;
});

// A throwaway key made at run time and never stored (format from emdash/dist/secrets: "emdash_enc_v1_" + 32 bytes base64url).
function throwawayEncryptionKey() {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	const b64url = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
	return `emdash_enc_v1_${b64url}`;
}

it("without EMDASH_ENCRYPTION_KEY, an update with a secret field is rejected whole", async ({ task }) => {
	delete process.env.EMDASH_ENCRYPTION_KEY;
	host = await createPluginRuntimeTestHost();
	const update = await host.actions.plugin.updateSettings({ spikeSecret: "spike-dummy-secret-not-real", spikeNote: "plain note" });
	const rawNote = await host.inspect.settings.raw("spikeNote");
	Object.assign(task.meta, { update: JSON.parse(JSON.stringify(update ?? null)), rawNote });
	expect(update).toMatchObject({ success: false, error: { code: "PLUGIN_SETTING_ENCRYPTION_KEY_MISSING" } });
	expect(rawNote).toBeNull();
});

const DUMMY = "spike-dummy-secret-not-real";

it("without EMDASH_ENCRYPTION_KEY, an update with only a plain field succeeds", async ({ task }) => {
	delete process.env.EMDASH_ENCRYPTION_KEY;
	host = await createPluginRuntimeTestHost();
	const update = await host.actions.plugin.updateSettings({ spikeNote: "plain note" });
	const rawNote = await host.inspect.settings.raw("spikeNote");
	const res = await host.actions.routes.request("settings-probe", { method: "GET" });
	const probe = ((await res.json()) as { data: Record<string, unknown> }).data;
	Object.assign(task.meta, { update: JSON.parse(JSON.stringify(update ?? null)), rawNote, probe });
	// Only secret fields need the key: a plain-only update succeeds and is stored as plain text.
	expect(update).toMatchObject({ success: true, data: { values: { spikeNote: "plain note" } } });
	expect(rawNote).toBe("plain note");
	expect(probe).toMatchObject({ noteViaSettings: { type: "string", length: 10 }, noteViaKv: { type: "string", length: 10 } });
});

it("with EMDASH_ENCRYPTION_KEY, secret settings are stored encrypted and read back as plaintext through ctx.settings", async ({ task }) => {
	process.env.EMDASH_ENCRYPTION_KEY = throwawayEncryptionKey();
	host = await createPluginRuntimeTestHost();
	const update = await host.actions.plugin.updateSettings({ spikeSecret: DUMMY, spikeNote: "plain note" });
	const rawSecret = await host.inspect.settings.raw("spikeSecret");
	const rawNote = await host.inspect.settings.raw("spikeNote");
	const res = await host.actions.routes.request("settings-probe", { method: "GET" });
	const probe = ((await res.json()) as { data: Record<string, unknown> }).data;
	const rawSecretJson = JSON.stringify(rawSecret);
	Object.assign(task.meta, {
		update: JSON.parse(JSON.stringify(update ?? null)),
		rawSecretShape: rawSecret && typeof rawSecret === "object" ? Object.keys(rawSecret).sort() : typeof rawSecret,
		rawSecretContainsPlaintext: rawSecretJson.includes(DUMMY),
		rawNote,
		probe,
	});

	expect(rawSecretJson).not.toContain(DUMMY);
	expect(rawNote).toBe("plain note");
	expect(probe).toMatchObject({
		hasSettings: true,
		secretViaSettings: { type: "string", length: DUMMY.length },
		noteViaSettings: { type: "string", length: "plain note".length },
	});
});
