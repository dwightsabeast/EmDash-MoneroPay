package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/noderpc"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/secret"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/walletrpc"
)

// TestLiveDaemonSSL runs the real wallet-rpc against an https node with each set of --daemon-ssl flags (run B attempt
// 1: "--daemon-ssl enabled" alone fails generate_from_keys with "wallet-rpc error 0"). For each case it creates the
// view-only shop wallet in a temporary directory, rescans from a recent block and compares the wallet's height with
// the node's. Run it under scripts/with-shop-env.sh with XMR_BRIDGE_LIVE_BIN_DIR, XMR_BRIDGE_LIVE_DATA and
// XMR_BRIDGE_LIVE_SSL_NODE (an https URL whose host has a publicly trusted certificate) set; XMR_BRIDGE_LIVE_SSL_IP
// adds a case that dials the same node by IP address, which certificate checking must refuse. The view key is never
// printed. Stagenet only.
func TestLiveDaemonSSL(t *testing.T) {
	addr, binDir, base, nodeURL := os.Getenv("SHOP_ADDRESS"), os.Getenv("XMR_BRIDGE_LIVE_BIN_DIR"), os.Getenv("XMR_BRIDGE_LIVE_DATA"), os.Getenv("XMR_BRIDGE_LIVE_SSL_NODE")
	view := secret.New(os.Getenv("SHOP_VIEW_KEY"))
	os.Unsetenv("SHOP_VIEW_KEY") // nothing started from here inherits it
	if addr == "" || view.IsEmpty() || binDir == "" || base == "" || nodeURL == "" {
		t.Skip("run under scripts/with-shop-env.sh with XMR_BRIDGE_LIVE_BIN_DIR, XMR_BRIDGE_LIVE_DATA and XMR_BRIDGE_LIVE_SSL_NODE set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	node, err := noderpc.GetInfo(ctx, nodeURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	if node.NetType != "stagenet" {
		t.Fatalf("the node is on %s", node.NetType)
	}
	host := nodeURL[len("https://"):]
	ca := "/etc/ssl/certs/ca-certificates.crt"
	cases := []struct {
		name   string
		daemon string
		flags  []string
	}{
		{"enabled alone (the shipped flags)", host, []string{"--daemon-ssl", "enabled"}},
		{"enabled with the system CA bundle, chained", host, []string{"--daemon-ssl", "enabled", "--daemon-ssl-ca-certificates", ca, "--daemon-ssl-allow-chained"}},
	}
	if ip := os.Getenv("XMR_BRIDGE_LIVE_SSL_IP"); ip != "" {
		cases = append(cases, struct {
			name   string
			daemon string
			flags  []string
		}{"the same, dialled by IP address (name mismatch)", ip, []string{"--daemon-ssl", "enabled", "--daemon-ssl-ca-certificates", ca, "--daemon-ssl-allow-chained"}})
	}
	t.Logf("node %s: %s at height %d", host, node.NetType, node.Height)
	for i, c := range cases {
		t.Logf("case %d, %s: %s", i+1, c.name, probeSSL(t, ctx, binDir, base, c.daemon, c.flags, addr, view, node.Height))
	}
}

// probeSSL starts wallet-rpc with daemon and flags, creates the wallet from 20 blocks below height, rescans, and
// describes what happened. The temporary directory is always deleted.
func probeSSL(t *testing.T, ctx context.Context, binDir, base, daemon string, flags []string, addr string, view secret.String, height uint64) string {
	dir, err := os.MkdirTemp(base, "ssl-probe-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	b := make([]byte, 16)
	rand.Read(b)
	pass := hex.EncodeToString(b)
	const port = "38998"
	args := append([]string{"--stagenet", "--non-interactive", "--rpc-bind-ip", "127.0.0.1", "--rpc-bind-port", port,
		"--rpc-login", "probe:" + pass, "--wallet-dir", dir, "--shared-ringdb-dir", filepath.Join(dir, "ringdb"),
		"--log-file", filepath.Join(dir, "wallet-rpc.log"),
		"--daemon-address", daemon}, flags...)
	cmd := exec.Command(filepath.Join(binDir, "monero-wallet-rpc"), args...)
	cmd.Env = []string{} // nothing inherited
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { cmd.Process.Kill(); cmd.Wait() }()
	c := walletrpc.New("http://127.0.0.1:"+port, "probe", secret.New(pass), &http.Client{Timeout: 5 * time.Minute})
	for i := 0; ; i++ {
		if _, err := c.GetVersion(ctx); err == nil {
			break
		} else if i == 60 {
			return fmt.Sprintf("wallet-rpc didn't start: %v", err)
		}
		time.Sleep(time.Second)
	}
	walletPass := secret.New(pass)
	if err := c.GenerateFromKeys(ctx, "probe", addr, view, walletPass, height-20); err != nil {
		return fmt.Sprintf("generate_from_keys: %v", err)
	}
	if err := c.RescanBlockchain(ctx); err != nil {
		return fmt.Sprintf("wallet created; rescan_blockchain: %v", err)
	}
	h, err := c.GetHeight(ctx)
	if err != nil {
		return fmt.Sprintf("wallet created and rescanned; get_height: %v", err)
	}
	return fmt.Sprintf("wallet created, rescanned over TLS, wallet height %d (node %d)", h, height)
}
