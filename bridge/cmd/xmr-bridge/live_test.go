package main

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"syscall"
	"testing"
	"time"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/config"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/moneroaddr"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/noderpc"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/secret"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/shopkeys"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/supervise"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/wallet"
)

// TestLiveShopWallet creates the view-only stagenet shop wallet with the real wallet-rpc and runs the bridge's
// start-up path on it. Run it under scripts/with-shop-env.sh (SHOP_ADDRESS, SHOP_VIEW_KEY, SHOP_RESTORE_HEIGHT),
// with XMR_BRIDGE_LIVE_BIN_DIR naming a directory that holds a verified monero-wallet-rpc and its installed.json
// (from the monerodl live test) and XMR_BRIDGE_LIVE_DATA a parent for the temporary data directory, which is
// deleted at the end. The view key is never printed. Stagenet only.
func TestLiveShopWallet(t *testing.T) {
	addr, binDir, base := os.Getenv("SHOP_ADDRESS"), os.Getenv("XMR_BRIDGE_LIVE_BIN_DIR"), os.Getenv("XMR_BRIDGE_LIVE_DATA")
	view := secret.New(os.Getenv("SHOP_VIEW_KEY"))
	os.Unsetenv("SHOP_VIEW_KEY") // nothing started from here inherits it
	if addr == "" || view.IsEmpty() || binDir == "" || base == "" {
		t.Skip("run under scripts/with-shop-env.sh with XMR_BRIDGE_LIVE_BIN_DIR and XMR_BRIDGE_LIVE_DATA set")
	}
	restore, err := strconv.ParseUint(os.Getenv("SHOP_RESTORE_HEIGHT"), 10, 64)
	if err != nil {
		t.Fatal("SHOP_RESTORE_HEIGHT is not a number")
	}
	if err := moneroaddr.CheckPrimary(addr, "stagenet"); err != nil {
		t.Fatalf("the shop address fails the bridge's check: %v", err)
	}
	if err := shopkeys.CheckViewKey(view.Reveal()); err != nil {
		t.Fatalf("the shop view key fails the bridge's check: %v", err)
	}
	if err := shopkeys.CheckViewKeyMatches(addr, view); err != nil {
		t.Fatalf("the shop view key doesn't match the shop address by the bridge's own check: %v", err)
	}
	t.Log("the real stagenet address and view key pass the bridge's checks, including view key * B == the address's public view key")

	data, err := os.MkdirTemp(base, "3c-live-")
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := os.RemoveAll(data); err != nil {
			t.Errorf("cleanup: %v", err)
		} else {
			t.Log("temporary wallet directory deleted")
		}
	}()
	for _, f := range []string{"monero-wallet-rpc", "installed.json"} {
		b, err := os.ReadFile(filepath.Join(binDir, f))
		if err != nil {
			t.Fatal(err)
		}
		os.MkdirAll(filepath.Join(data, "bin"), 0o755)
		if err := os.WriteFile(filepath.Join(data, "bin", f), b, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	cfg := config.Config{Site: "http://localhost:4321", Network: config.Stagenet, Address: addr, Node: "http://127.0.0.1:38081",
		DataDir: data, RestoreHeight: restore, AllowSameMachine: true}
	if err := cfg.Validate(); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()

	// 1. Create the wallet the way the installer will: wallet-rpc without a wallet, then Create.
	sup, err := supervise.New(supervise.Options{Binary: filepath.Join(data, "bin", "monero-wallet-rpc"), DataDir: data, Network: cfg.Network, Node: cfg.Node})
	if err != nil {
		t.Fatal(err)
	}
	sctx, scancel := context.WithCancel(ctx)
	sdone := make(chan struct{})
	go func() { sup.Run(sctx); close(sdone) }()
	stopFirst := func() { scancel(); <-sdone } // wallet-rpc must be gone before the directory is deleted
	defer stopFirst()
	c, err := sup.WaitReady(ctx)
	if err != nil {
		t.Fatal(err)
	}
	node, err := noderpc.GetInfo(ctx, cfg.Node, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("node: %s at height %d, synchronized %v", node.NetType, node.Height, node.Synchronized)
	wrong := secret.New("0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f00")
	if err := wallet.Create(ctx, c, cfg, wrong, node); !errors.Is(err, wallet.ErrViewKeyMismatch) {
		t.Fatalf("a wrong view key: %v", err)
	}
	if wallet.Exists(data) {
		t.Fatal("a wrong view key left a wallet")
	}
	t.Log("a view key that isn't this address's was refused before reaching wallet-rpc (spec change 11)")
	if err := wallet.Create(ctx, c, cfg, view, node); err != nil {
		t.Fatal(err)
	}
	t.Logf("view-only wallet created from restore height %d", restore)
	stopFirst()

	// 2. The bridge's own start-up: supervise and open the wallet.
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	h, err := defaultStartBridge(ctx, cfg, log)
	if err != nil {
		t.Fatal(err)
	}
	defer h.Stop()
	r := h.(*running)
	c, err = r.sup.WaitReady(ctx)
	if err != nil {
		t.Fatal(err)
	}
	got, err := c.GetAddress(ctx)
	if err != nil || got != addr {
		t.Fatalf("opened wallet is not the shop address (%v)", err)
	}
	t.Log("run's start-up opened the wallet; get_address matches the shop address")
	begin := time.Now()
	var height uint64
	for {
		if height, err = c.GetHeight(ctx); err == nil && height+2 >= node.Height {
			break
		}
		if time.Since(begin) > 15*time.Minute {
			t.Fatalf("wallet not synced: at %d of %d (%v)", height, node.Height, err)
		}
		time.Sleep(5 * time.Second)
	}
	t.Logf("wallet synced to %d in %v", height, time.Since(begin).Round(time.Second))
	// The phase 01 spike's 0.001 XMR stagenet payment went to subaddress 1 at height 2221449
	// (spikes/wallet/evidence/q7-normal-payment.txt); a fresh view-only wallet must find it.
	transfers, err := c.GetTransfers(ctx, []uint32{0, 1})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, tr := range transfers {
		t.Logf("incoming to index %d: %s atomic, height %d, confirmations %d, unlock %s, pool %v", tr.Index, tr.Amount, tr.Height, tr.Confirmations, tr.UnlockTime, tr.Pool)
		found = found || (tr.Index == 1 && tr.Amount == "1000000000" && tr.Height == 2221449 && tr.UnlockTime == "0")
	}
	if !found && restore <= 2221449 {
		t.Fatal("the spike's payment to subaddress 1 was not found")
	}
	t.Logf("%d incoming transfer(s) to indexes 0 and 1; the spike's payment found: %v", len(transfers), found)

	// 3. kill -9: the supervisor restarts wallet-rpc and Init reopens the wallet.
	first := r.sup.Status().PID
	syscall.Kill(first, syscall.SIGKILL)
	for deadline := time.Now().Add(3 * time.Minute); ; time.Sleep(500 * time.Millisecond) {
		if st := r.sup.Status(); st.Ready && st.PID != first {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("not reopened after kill -9: %+v", r.sup.Status())
		}
	}
	c, err = r.sup.WaitReady(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if got, err := c.GetAddress(ctx); err != nil || got != addr {
		t.Fatalf("after restart: %v", err)
	}
	st := r.sup.Status()
	t.Logf("after kill -9: restarted (pid changed, restarts %d) and the wallet reopened", st.Restarts)
	for _, f := range []string{"shop", "shop.keys", "shop.password"} {
		if fi, err := os.Stat(filepath.Join(data, "wallet", f)); err == nil {
			t.Logf("wallet/%s mode %v", f, fi.Mode().Perm())
		}
	}
	fi, _ := os.Stat(filepath.Join(data, "wallet"))
	t.Logf("wallet/ mode %v", fi.Mode().Perm())
	h.Stop()
	if pid := st.PID; syscall.Kill(pid, 0) == nil {
		t.Fatalf("wallet-rpc %d still running after stop", pid)
	}
	t.Log("stopped; no wallet-rpc left running")
}
