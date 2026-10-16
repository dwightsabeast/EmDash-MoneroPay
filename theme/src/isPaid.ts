/**
 * For gated content: true only when the invoice behind the token is settled, read on the server (docs/spec.md, Theme
 * integration, "Gating"). Never trust a flag from the browser. Anything else is false: a malformed or unknown token,
 * an open, expired or review invoice, or a plugin that can't answer.
 *
 *   ---
 *   import { isPaid } from "@cofferhq/astro/isPaid";
 *   if (!(await isPaid(Astro, Astro.url.searchParams.get("token")))) return Astro.redirect("/");
 *   ---
 */
import { fetchStatus } from "./status";

export async function isPaid(astro: { locals: unknown; url: URL }, token: unknown): Promise<boolean> {
	const r = await fetchStatus(astro, token);
	return r.ok && r.status.status === "settled";
}
