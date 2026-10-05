package selfupdate

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func runGuard(t *testing.T, data string) string {
	t.Helper()
	script := filepath.Join(t.TempDir(), "update-guard.sh")
	os.WriteFile(script, []byte(GuardScript), 0o755)
	cmd := exec.Command("/bin/sh", script)
	cmd.Env = []string{"PATH=/usr/bin:/bin", "XMR_BRIDGE_DATA=" + data}
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("the guard must never fail a start: %v %s", err, out)
	}
	return string(out)
}

func setupData(t *testing.T) (string, Files) {
	d := t.TempDir()
	for _, sub := range []string{"bin", "run", "wallet/backup"} {
		os.MkdirAll(filepath.Join(d, sub), 0o700)
	}
	w := func(p, s string) { os.WriteFile(filepath.Join(d, p), []byte(s), 0o600) }
	w("bin/xmr-bridge", "new bridge")
	w("bin/xmr-bridge.prev", "old bridge")
	w("bin/monero-wallet-rpc", "new wallet-rpc")
	w("bin/monero-wallet-rpc.prev", "old wallet-rpc")
	w("bin/installed.json", "new")
	w("bin/installed.json.prev", "old")
	w("wallet/shop", "upgraded wallet")
	w("wallet/backup/shop", "wallet before")
	w("wallet/backup/shop.keys", "keys before")
	return d, Files{DataDir: d}
}

func read(t *testing.T, d, p string) string {
	b, _ := os.ReadFile(filepath.Join(d, p))
	return string(b)
}

func TestGuardNothingPending(t *testing.T) {
	d, _ := setupData(t)
	for i := 0; i < 5; i++ {
		runGuard(t, d)
	}
	if read(t, d, "bin/xmr-bridge") != "new bridge" {
		t.Fatal("rolled back with no update pending")
	}
	if _, err := os.Stat(filepath.Join(d, "run/start-count")); !os.IsNotExist(err) {
		t.Fatal("counted with no update pending")
	}
}

func TestGuardRollsBackBridgeOnFourthStart(t *testing.T) {
	d, f := setupData(t)
	f.SetPending(Pending{Kind: KindBridge, Version: "0.3.0", Previous: "0.2.0", At: time.Now()})
	for i := 1; i <= 3; i++ {
		runGuard(t, d)
		if read(t, d, "bin/xmr-bridge") != "new bridge" || f.StartCount() != i {
			t.Fatalf("start %d: rolled back early or miscounted (%d)", i, f.StartCount())
		}
	}
	out := runGuard(t, d)
	if read(t, d, "bin/xmr-bridge") != "old bridge" || !strings.Contains(out, "rolled back") {
		t.Fatalf("not rolled back on the 4th start: %q", out)
	}
	if _, ok := f.Pending(); ok || !f.Refused(KindBridge, "0.3.0") || f.Refused(KindBridge, "0.3.1") {
		t.Fatal("pending not cleared, or the version not refused")
	}
	if fi, _ := os.Stat(filepath.Join(d, "run/refused")); fi.Mode().Perm()&0o077 != 0 {
		t.Fatalf("refused file mode %v", fi.Mode().Perm())
	}
}

func TestGuardResetByAProperStart(t *testing.T) {
	d, f := setupData(t)
	f.SetPending(Pending{Kind: KindBridge, Version: "0.3.0", Previous: "0.2.0", At: time.Now()})
	runGuard(t, d)
	runGuard(t, d)
	f.MarkStarted() // the new binary got wallet-rpc ready and the wallet open
	runGuard(t, d)
	runGuard(t, d)
	if read(t, d, "bin/xmr-bridge") != "new bridge" {
		t.Fatal("rolled back although the new binary had started properly (reboots must not add up)")
	}
}

func TestGuardRollsBackWalletRPC(t *testing.T) {
	d, f := setupData(t)
	f.SetPending(Pending{Kind: KindWalletRPC, Version: "0.18.6.0", Previous: "0.18.5.1", At: time.Now()})
	for i := 0; i < 4; i++ {
		runGuard(t, d)
	}
	if read(t, d, "bin/monero-wallet-rpc") != "old wallet-rpc" || read(t, d, "bin/installed.json") != "old" ||
		read(t, d, "wallet/shop") != "wallet before" || read(t, d, "wallet/shop.keys") != "keys before" {
		t.Fatal("wallet-rpc, its record or the wallet backup not restored")
	}
	if read(t, d, "bin/xmr-bridge") != "new bridge" || !f.Refused(KindWalletRPC, "0.18.6.0") {
		t.Fatal("touched the bridge, or didn't refuse the version")
	}
}

func TestGuardBadCounter(t *testing.T) {
	d, f := setupData(t)
	f.SetPending(Pending{Kind: KindBridge, Version: "0.3.0", Previous: "0.2.0", At: time.Now()})
	os.WriteFile(filepath.Join(d, "run/start-count"), []byte("junk; rm -rf /\n"), 0o600)
	runGuard(t, d)
	if f.StartCount() != 1 {
		t.Fatalf("a garbled counter must restart at 1, got %d", f.StartCount())
	}
}
