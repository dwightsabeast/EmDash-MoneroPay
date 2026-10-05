package main

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/bridgeloop"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/config"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/crosscheck"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/syncsign"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/testaddr"
)

const testCode = "AbCdEfGhIjKlMnOpQrSt_-"

// pairingSite accepts testCode once, verifying the request with the key it carries, as the plugin does.
func pairingSite(t *testing.T) (*httptest.Server, *string) {
	var paired string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var b struct {
			Pair *struct{ Code, PublicKey string } `json:"pair"`
		}
		json.Unmarshal(body, &b)
		reply := `{"success":true,"data":{"error":{"code":"PAIRING_REJECTED"}}}`
		if b.Pair != nil && b.Pair.Code == testCode && paired == "" {
			pub, _ := base64.StdEncoding.DecodeString(b.Pair.PublicKey)
			sig, _ := base64.StdEncoding.DecodeString(r.Header.Get("x-xmr-sig"))
			if ed25519.Verify(pub, syncsign.Message(r.Header.Get("x-xmr-ts"), body), sig) {
				paired = b.Pair.PublicKey
				reply = `{"success":true,"data":{"ok":true,"poolFree":0,"poolTarget":50,"watch":[]}}`
			}
		}
		io.WriteString(w, reply)
	}))
	t.Cleanup(srv.Close)
	return srv, &paired
}

func writeConfig(t *testing.T, site string) (string, config.Config) {
	t.Helper()
	c := config.Config{Site: site, Network: config.Stagenet, Address: testaddr.Stagenet, Node: "http://127.0.0.1:1", DataDir: t.TempDir(), AllowSameMachine: true}
	p := filepath.Join(t.TempDir(), "config")
	if err := config.Save(p, c); err != nil {
		t.Fatal(err)
	}
	return p, c
}

func TestPairCommand(t *testing.T) {
	srv, paired := pairingSite(t)
	p, c := writeConfig(t, srv.URL)
	code, out, errOut := run(context.Background(), "pair", "--config", p, "--code", testCode)
	if code != 0 || !strings.Contains(out, "Paired") {
		t.Fatalf("pair: %d %q %q", code, out, errOut)
	}
	k, err := syncsign.LoadKey(filepath.Join(c.DataDir, "bridge.key"))
	if err != nil || syncsign.PublicKeyText(k) != *paired {
		t.Fatalf("saved key doesn't match the paired one: %v", err)
	}
	// The code is used: a second attempt fails with the fix and keeps the key.
	code, _, errOut = run(context.Background(), "pair", "--config", p, "--code", testCode)
	if code != 1 || !strings.Contains(errOut, "PAIRING_REJECTED") || !strings.Contains(errOut, "used or expired") {
		t.Fatalf("reused code: %d %q", code, errOut)
	}
	if k2, _ := syncsign.LoadKey(filepath.Join(c.DataDir, "bridge.key")); !k2.Equal(k) {
		t.Fatal("a failed pairing replaced the key")
	}
	if code, _, _ := run(context.Background(), "pair", "--config", p); code != 2 {
		t.Fatal("pair without --code accepted")
	}
}

func TestStatusCommand(t *testing.T) {
	p, c := writeConfig(t, "https://shop.example")
	code, out, _ := run(context.Background(), "status", "--config", p)
	if code != 1 || !strings.Contains(out, "not paired") || !strings.Contains(out, "never") {
		t.Fatalf("fresh: %d %q", code, out)
	}
	k, _ := syncsign.NewKey()
	syncsign.SaveKey(filepath.Join(c.DataDir, "bridge.key"), k)
	os.MkdirAll(filepath.Join(c.DataDir, "run"), 0o700)
	write := func(st bridgeloop.Status) {
		b, _ := json.Marshal(st)
		os.WriteFile(filepath.Join(c.DataDir, "run", "status.json"), b, 0o600)
	}
	now := time.Now()
	write(bridgeloop.Status{LastAttemptAt: now, LastSyncAt: now, WalletHeight: 2222000, PoolFree: 48, PoolTarget: 50, Watching: 2})
	code, out, _ = run(context.Background(), "status", "--config", p)
	if code != 0 || !strings.Contains(out, "48 of 50") || !strings.Contains(out, "2222000") || !strings.Contains(out, "Paired:") {
		t.Fatalf("healthy: %d %q", code, out)
	}
	write(bridgeloop.Status{LastAttemptAt: now, LastSyncAt: now.Add(-10 * time.Minute), LastError: "the site can't be reached: dial tcp: connection refused"})
	code, out, _ = run(context.Background(), "status", "--config", p)
	if code != 1 || !strings.Contains(out, "connection refused") {
		t.Fatalf("failing: %d %q", code, out)
	}
	write(bridgeloop.Status{LastAttemptAt: now.Add(-10 * time.Minute), LastSyncAt: now.Add(-10 * time.Minute)})
	code, out, _ = run(context.Background(), "status", "--config", p)
	if code != 1 || !strings.Contains(out, "systemctl status xmr-bridge") {
		t.Fatalf("not running: %d %q", code, out)
	}
}

func TestStatusNodeCheck(t *testing.T) {
	p, c := writeConfig(t, "https://shop.example")
	k, _ := syncsign.NewKey()
	syncsign.SaveKey(filepath.Join(c.DataDir, "bridge.key"), k)
	os.MkdirAll(filepath.Join(c.DataDir, "run"), 0o700)
	now := time.Now()
	for state, want := range map[crosscheck.State]struct {
		code int
		text string
	}{
		crosscheck.Off:         {0, "off (the node is your own)"},
		crosscheck.OK:          {0, "ok (checked with second.example:38089)"},
		crosscheck.Unavailable: {0, "unavailable"},
		crosscheck.Mismatch:    {1, "MISMATCH: block 100 differs"},
	} {
		b, _ := json.Marshal(bridgeloop.Status{LastAttemptAt: now, LastSyncAt: now, PoolTarget: 50, PoolFree: 50,
			NodeCheck: crosscheck.Report{State: state, Detail: "block 100 differs", Node: "second.example:38089"}})
		os.WriteFile(filepath.Join(c.DataDir, "run", "status.json"), b, 0o600)
		code, out, _ := run(context.Background(), "status", "--config", p)
		if code != want.code || !strings.Contains(out, "Node check: "+want.text) {
			t.Errorf("%s: %d %q", state, code, out)
		}
	}
}

// The admin copy may lag the self-updated service copy: status and pair refuse a newer state format.
func TestAdminCommandsCheckStateFormat(t *testing.T) {
	srv, _ := pairingSite(t)
	p, c := writeConfig(t, srv.URL)
	os.MkdirAll(filepath.Join(c.DataDir, "run"), 0o700)
	os.WriteFile(filepath.Join(c.DataDir, "run", "update-state.json"), []byte(`{"format":99}`), 0o600)
	for _, args := range [][]string{{"status", "--config", p}, {"pair", "--config", p, "--code", testCode}} {
		code, out, errOut := run(context.Background(), args...)
		if code != 1 || !strings.Contains(strings.ToLower(out+errOut), "re-run the installer") {
			t.Errorf("%v: %d %q %q", args[0], code, out, errOut)
		}
	}
	if _, err := os.Stat(filepath.Join(c.DataDir, "bridge.key")); !os.IsNotExist(err) {
		t.Fatal("pair went ahead")
	}
}

// Run as root, pair hands the new key to the service account (otherwise the service couldn't read it).
func TestPairAsRootHandsTheKeyOver(t *testing.T) {
	srv, _ := pairingSite(t)
	p, c := writeConfig(t, srv.URL)
	var handed [2]int
	prevRoot, prevOwner := isRoot, chownKey
	isRoot = func() bool { return true }
	chownKey = func(path string) error {
		handed = [2]int{1, 1}
		if path != keyFile(c) {
			t.Errorf("handed %s", path)
		}
		return nil
	}
	defer func() { isRoot, chownKey = prevRoot, prevOwner }()
	if code, _, errOut := run(context.Background(), "pair", "--config", p, "--code", testCode); code != 0 {
		t.Fatalf("%d %s", code, errOut)
	}
	if handed != [2]int{1, 1} {
		t.Fatal("the key wasn't handed to the service account")
	}
}
