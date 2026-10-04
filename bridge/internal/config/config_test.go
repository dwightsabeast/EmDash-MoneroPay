package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/testaddr"
)

func valid() Config {
	return Config{
		Site:       "https://shop.example",
		Network:    Stagenet,
		Address:    testaddr.Stagenet,
		Node:       "http://127.0.0.1:38081",
		DataDir:    "/var/lib/xmr-bridge",
		AutoUpdate: true,
	}
}

func write(t *testing.T, body string, mode os.FileMode) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "config")
	if err := os.WriteFile(p, []byte(body), mode); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(p, mode); err != nil { // umask may have narrowed it
		t.Fatal(err)
	}
	return p
}

func TestSaveLoadRoundTrip(t *testing.T) {
	p := filepath.Join(t.TempDir(), "config")
	c := valid()
	c.RestoreHeight = 2_200_000
	if err := Save(p, c); err != nil {
		t.Fatal(err)
	}
	fi, err := os.Stat(p)
	if err != nil {
		t.Fatal(err)
	}
	if fi.Mode().Perm() != 0o600 {
		t.Fatalf("mode %v, want 0600", fi.Mode().Perm())
	}
	got, err := Load(p)
	if err != nil {
		t.Fatal(err)
	}
	if got != c {
		t.Fatalf("round trip: got %+v, want %+v", got, c)
	}
	// Saving again replaces the file atomically and leaves no temporary files behind.
	c.AutoUpdate = false
	if err := Save(p, c); err != nil {
		t.Fatal(err)
	}
	entries, _ := os.ReadDir(filepath.Dir(p))
	if len(entries) != 1 {
		t.Fatalf("leftover files: %v", entries)
	}
}

func TestLoadRefusesReadableByOthers(t *testing.T) {
	for _, mode := range []os.FileMode{0o640, 0o604, 0o644, 0o660} {
		p := write(t, `{"site":"https://shop.example","network":"stagenet","address":"`+testaddr.Stagenet+`","node":"http://127.0.0.1:38081","dataDir":"/var/lib/xmr-bridge"}`, mode)
		if _, err := Load(p); err == nil || !strings.Contains(err.Error(), "chmod 600") {
			t.Fatalf("mode %v: want a chmod 600 error, got %v", mode, err)
		}
	}
}

func TestLoadStrictJSON(t *testing.T) {
	base := `"site":"https://shop.example","network":"stagenet","address":"` + testaddr.Stagenet + `","node":"http://127.0.0.1:38081","dataDir":"/var/lib/xmr-bridge"`
	cases := map[string]string{
		"unknown field":   `{` + base + `,"viewKey":"abc"}`,
		"trailing data":   `{` + base + `} {}`,
		"not an object":   `[]`,
		"wrong type":      `{` + base + `,"restoreHeight":"10"}`,
		"negative height": `{` + base + `,"restoreHeight":-1}`,
		"empty":           ``,
	}
	for name, body := range cases {
		if _, err := Load(write(t, body, 0o600)); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	if _, err := Load(write(t, `{`+base+`}`, 0o600)); err != nil {
		t.Fatalf("minimal config refused: %v", err)
	}
}

func TestLoadSizeCap(t *testing.T) {
	big := `{"site":"https://shop.example","network":"stagenet","address":"` + testaddr.Stagenet + `","node":"http://127.0.0.1:38081","dataDir":"/x","pad":"` + strings.Repeat("a", 70_000) + `"}`
	if _, err := Load(write(t, big, 0o600)); err == nil || !strings.Contains(err.Error(), "too large") {
		t.Fatalf("want too large, got %v", err)
	}
}

func TestValidate(t *testing.T) {
	ok := []func(*Config){
		func(c *Config) {},
		func(c *Config) { c.Site = "https://shop.example/" },
		func(c *Config) { c.Site = "https://shop.example:8443" },
		func(c *Config) { c.Site = "http://localhost:4321" },
		func(c *Config) { c.Site = "http://127.0.0.1:4322" },
		func(c *Config) { c.Site = "http://[::1]:4321" },
		func(c *Config) {
			c.Network = Mainnet
			c.Address = testaddr.Mainnet
			c.Node = "https://node.example:18089"
		},
		func(c *Config) { c.AllowSameMachine = true }, // stagenet only
	}
	for i, f := range ok {
		c := valid()
		f(&c)
		if err := c.Validate(); err != nil {
			t.Errorf("ok case %d: %v", i, err)
		}
	}
	bad := map[string]func(*Config){
		"http site off loopback":     func(c *Config) { c.Site = "http://shop.example" },
		"site with a path":           func(c *Config) { c.Site = "https://shop.example/blog" },
		"site with a query":          func(c *Config) { c.Site = "https://shop.example/?a=1" },
		"site with user info":        func(c *Config) { c.Site = "https://u:p@shop.example" },
		"site not a URL":             func(c *Config) { c.Site = "shop.example" },
		"site empty":                 func(c *Config) { c.Site = "" },
		"unknown network":            func(c *Config) { c.Network = "regtest" },
		"node empty":                 func(c *Config) { c.Node = "" },
		"node not http":              func(c *Config) { c.Node = "ftp://127.0.0.1:38081" },
		"node with user info":        func(c *Config) { c.Node = "http://u:p@127.0.0.1:38081" },
		"data dir relative":          func(c *Config) { c.DataDir = "data" },
		"data dir empty":             func(c *Config) { c.DataDir = "" },
		"same machine on mainnet":    func(c *Config) { c.Network = Mainnet; c.Address = testaddr.Mainnet; c.AllowSameMachine = true },
		"same machine on testnet":    func(c *Config) { c.Network = Testnet; c.Address = testaddr.Testnet; c.AllowSameMachine = true },
		"address missing":            func(c *Config) { c.Address = "" },
		"address of another network": func(c *Config) { c.Address = testaddr.Mainnet },
		"subaddress":                 func(c *Config) { c.Address = testaddr.Make(36, 1) },
	}
	for name, f := range bad {
		c := valid()
		f(&c)
		if err := c.Validate(); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestSaveRefusesInvalid(t *testing.T) {
	c := valid()
	c.Network = Mainnet
	c.Address = testaddr.Mainnet
	c.AllowSameMachine = true
	p := filepath.Join(t.TempDir(), "config")
	if err := Save(p, c); err == nil {
		t.Fatal("saved an invalid config")
	}
	if _, err := os.Stat(p); !os.IsNotExist(err) {
		t.Fatal("an invalid config left a file")
	}
}
