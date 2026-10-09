package sitetext

import (
	"os"
	"strings"
	"testing"
)

func TestButton(t *testing.T) {
	// Wyatt, 2026-10-09: quote the button's exact labels, before and after setup.
	want := `"Connect wallet host" on the site's Monero payments page (after setup, it's "Connect a new wallet host" under Settings)`
	if Button != want {
		t.Fatalf("Button = %q", Button)
	}
}

func TestLabelsMatchThePlugin(t *testing.T) {
	// The admin page is the plugin's (plugin/src/admin.ts); the bridge's messages must quote what it shows.
	src, err := os.ReadFile("../../../plugin/src/admin.ts")
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range []string{`"Connect wallet host"`, `"Connect a new wallet host"`, `text: "Settings"`, `"Monero payments"`} {
		if !strings.Contains(string(src), s) {
			t.Errorf("plugin/src/admin.ts no longer has %s", s)
		}
	}
}
