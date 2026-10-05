package installer

import (
	"context"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func write(t *testing.T, path, content string) {
	t.Helper()
	os.MkdirAll(filepath.Dir(path), 0o755)
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func noLookup(context.Context, string) ([]net.IP, error) { return nil, errors.New("no DNS in tests") }
func localIPs() ([]net.IP, error)                        { return []net.IP{net.ParseIP("192.168.1.10")}, nil }

func TestSameMachineSignals(t *testing.T) {
	root := t.TempDir()
	d := Detector{Root: root, Lookup: noLookup, LocalIPs: localIPs}
	if s := d.Signals(context.Background(), "https://shop.example"); len(s) != 0 {
		t.Fatalf("clean machine: %v", s)
	}
	// Processes, read from /proc/<pid>/cmdline (NUL-separated).
	write(t, filepath.Join(root, "proc/101/cmdline"), "node\x00/usr/bin/npm\x00run\x00dev\x00")
	write(t, filepath.Join(root, "proc/102/cmdline"), "node\x00/home/u/site/node_modules/.bin/astro\x00dev\x00")
	s := d.Signals(context.Background(), "https://shop.example")
	if len(s) != 1 || !strings.Contains(s[0], "astro dev") {
		t.Fatalf("astro dev: %v", s)
	}
	for _, cmd := range []string{"node\x00./dist/server/entry.mjs\x00", "/usr/local/bin/workerd\x00serve\x00config.capnp\x00", "node\x00/srv/x/node_modules/emdash/bin.js\x00"} {
		r := t.TempDir()
		write(t, filepath.Join(r, "proc/7/cmdline"), cmd)
		if s := (Detector{Root: r, Lookup: noLookup, LocalIPs: localIPs}).Signals(context.Background(), "https://shop.example"); len(s) != 1 {
			t.Errorf("%q: %v", cmd, s)
		}
	}
}

func TestSameMachineConfigFile(t *testing.T) {
	root := t.TempDir()
	write(t, filepath.Join(root, "home/u/sites/shop/astro.config.mjs"), "import emdash from \"emdash/astro\";\nexport default {}\n")
	write(t, filepath.Join(root, "home/u/other/astro.config.mjs"), "export default {}\n")        // Astro without EmDash
	write(t, filepath.Join(root, "home/u/sites/shop/node_modules/x/astro.config.mjs"), "emdash") // never inside node_modules
	s := (Detector{Root: root, Lookup: noLookup, LocalIPs: localIPs}).Signals(context.Background(), "https://shop.example")
	if len(s) != 1 || !strings.Contains(s[0], "sites/shop/astro.config.mjs") {
		t.Fatalf("%v", s)
	}
}

func TestSameMachineSiteAddress(t *testing.T) {
	root := t.TempDir()
	lookup := func(_ context.Context, host string) ([]net.IP, error) {
		if host == "shop.example" {
			return []net.IP{net.ParseIP("192.168.1.10")}, nil
		}
		return []net.IP{net.ParseIP("203.0.113.5")}, nil
	}
	d := Detector{Root: root, Lookup: lookup, LocalIPs: localIPs}
	if s := d.Signals(context.Background(), "https://shop.example"); len(s) != 1 || !strings.Contains(s[0], "resolves to this machine") {
		t.Fatalf("%v", s)
	}
	if s := d.Signals(context.Background(), "https://elsewhere.example"); len(s) != 0 {
		t.Fatalf("%v", s)
	}
	if s := d.Signals(context.Background(), "http://localhost:4321"); len(s) != 1 {
		t.Fatalf("localhost: %v", s)
	}
}
