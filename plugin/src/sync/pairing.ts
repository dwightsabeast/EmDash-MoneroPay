/**
 * Pairing codes (docs/spec.md, `bridge/sync`, Pairing): 128-bit random, shown once as 22 base64url characters,
 * stored only as a SHA-256 hash with a 15-minute expiry, and burned on use.
 */
export const PAIRING_TTL_MS = 15 * 60_000;

/** What KV holds. `used` keeps the burned hash so a reused code is rejected the same way as a wrong one. */
export interface PairingState {
	codeHash: string;
	expiresAt: number;
	used: boolean;
}

function base64url(bytes: Uint8Array): string {
	let s = "";
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hashPairingCode(code: string): Promise<string> {
	return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code))));
}

/** A fresh code for the admin page, and the state to store. The code itself is never stored. */
export async function newPairingCode(now: number): Promise<{ code: string; state: PairingState }> {
	const code = base64url(crypto.getRandomValues(new Uint8Array(16)));
	return { code, state: { codeHash: await hashPairingCode(code), expiresAt: now + PAIRING_TTL_MS, used: false } };
}

export const isPairingActive = (state: PairingState | null, now: number): state is PairingState =>
	state !== null && !state.used && now < state.expiresAt;

/** Wrong, expired and already-used codes all fail the same way (PAIRING_REJECTED), so a caller can't tell them apart. */
export async function pairingCodeMatches(state: PairingState | null, code: string, now: number): Promise<boolean> {
	if (!isPairingActive(state, now)) return false;
	const hash = await hashPairingCode(code);
	let diff = hash.length ^ state.codeHash.length;
	for (let i = 0; i < Math.min(hash.length, state.codeHash.length); i++) diff |= hash.charCodeAt(i) ^ state.codeHash.charCodeAt(i);
	return diff === 0;
}
