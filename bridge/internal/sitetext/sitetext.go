// Package sitetext holds wording that names things on the site's admin page, so every message the bridge prints quotes
// the page the same way. The labels are the plugin's (plugin/src/admin.ts); a test checks they're still there.
package sitetext

// Button is where an admin gets a pairing code: the button's label before setup is done, and after it, when the button
// is "Connect a new wallet host" inside Settings (Wyatt, 2026-10-09).
const Button = `"Connect wallet host" on the site's Monero payments page (after setup, it's "Connect a new wallet host" under Settings)`
