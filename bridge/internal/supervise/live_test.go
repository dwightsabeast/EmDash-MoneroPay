package supervise

import (
	"context"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/config"
)

// TestLiveWalletRPC supervises the real monero-wallet-rpc named by XMR_BRIDGE_LIVE_WALLET_RPC against the stagenet
// node at 127.0.0.1:38081, in a data directory under XMR_BRIDGE_LIVE_DATA: ready, no login on its command line,
// restarted after kill -9 with a new login, nothing left after stop. Skipped by default.
func TestLiveWalletRPC(t *testing.T) {
	bin, base := os.Getenv("XMR_BRIDGE_LIVE_WALLET_RPC"), os.Getenv("XMR_BRIDGE_LIVE_DATA")
	if bin == "" || base == "" {
		t.Skip("set XMR_BRIDGE_LIVE_WALLET_RPC and XMR_BRIDGE_LIVE_DATA to supervise a real wallet-rpc")
	}
	data, err := os.MkdirTemp(base, "supervise-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(data)
	s, err := New(Options{Binary: bin, DataDir: data, Network: config.Stagenet, Node: "http://127.0.0.1:38081", StopTimeout: 30 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- s.Run(ctx) }()
	defer func() {
		cancel()
		<-done
	}()

	wait, waitCancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer waitCancel()
	c1, err := s.WaitReady(wait)
	if err != nil {
		t.Fatal(err)
	}
	v, err := c1.GetVersion(wait)
	if err != nil {
		t.Fatal(err)
	}
	st := s.Status()
	t.Logf("ready: pid %d port %d, RPC version %d.%d", st.PID, st.Port, v.Version>>16, v.Version&0xffff)
	cmdline, _ := os.ReadFile(filepath.Join("/proc", strconv.Itoa(st.PID), "cmdline"))
	if strings.Contains(string(cmdline), "rpc-login") || !strings.Contains(string(cmdline), "--config-file") {
		t.Fatalf("command line: %q", strings.ReplaceAll(string(cmdline), "\x00", " "))
	}
	if _, err := os.Stat(filepath.Join(data, "run", "wallet-rpc.conf")); !os.IsNotExist(err) {
		t.Fatal("login file still present after ready")
	}
	if _, err := os.Stat(filepath.Join(data, "log", "wallet-rpc.log")); err != nil {
		t.Fatalf("no wallet-rpc log: %v", err)
	}

	first := st.PID
	syscall.Kill(first, syscall.SIGKILL)
	for deadline := time.Now().Add(90 * time.Second); ; time.Sleep(200 * time.Millisecond) {
		if st = s.Status(); st.Ready && st.PID != first {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("not restarted: %+v", st)
		}
	}
	c2, err := s.WaitReady(wait)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c2.GetVersion(wait); err != nil {
		t.Fatalf("after restart: %v", err)
	}
	t.Logf("restarted after kill -9: pid %d port %d, restarts %d, last exit %q", st.PID, st.Port, st.Restarts, st.LastExit)

	second := st.PID
	cancel()
	<-done
	done <- nil // for the deferred receive
	if alive(first) || alive(second) {
		t.Fatalf("wallet-rpc left running: %d %v, %d %v", first, alive(first), second, alive(second))
	}
	t.Log("stopped; no wallet-rpc left running")
}
