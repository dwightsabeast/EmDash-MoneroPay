package main

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/config"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/noderpc"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/secret"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/supervise"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/wallet"
)

// TestLiveLookahead is spec change 9's shop-wallet stand-in (phase 03, session 3h). A payment went to a subaddress
// far past the last paid one (XMR_BRIDGE_LIVE_LOOKAHEAD_INDEX). This test restores a second view-only wallet from the
// shop's keys with wallet-rpc's default settings, as the shop's wallet app would be, and records whether it sees that
// payment: as restored, after creating subaddresses up to the index, and after a rescan. Evidence, not a pass/fail on
// the first two; it fails only if even a rescan doesn't find the payment. Run it under scripts/with-shop-env.sh with
// XMR_BRIDGE_LIVE_BIN_DIR and XMR_BRIDGE_LIVE_DATA as for TestLiveShopWallet. The view key is never printed; the
// temporary wallet is deleted at the end. Stagenet only.
func TestLiveLookahead(t *testing.T) {
	addr, binDir, base := os.Getenv("SHOP_ADDRESS"), os.Getenv("XMR_BRIDGE_LIVE_BIN_DIR"), os.Getenv("XMR_BRIDGE_LIVE_DATA")
	view := secret.New(os.Getenv("SHOP_VIEW_KEY"))
	os.Unsetenv("SHOP_VIEW_KEY")
	far, ferr := strconv.ParseUint(os.Getenv("XMR_BRIDGE_LIVE_LOOKAHEAD_INDEX"), 10, 32)
	if addr == "" || view.IsEmpty() || binDir == "" || base == "" || ferr != nil {
		t.Skip("run under scripts/with-shop-env.sh with XMR_BRIDGE_LIVE_BIN_DIR, XMR_BRIDGE_LIVE_DATA and XMR_BRIDGE_LIVE_LOOKAHEAD_INDEX set")
	}
	restore, err := strconv.ParseUint(os.Getenv("SHOP_RESTORE_HEIGHT"), 10, 64)
	if err != nil {
		t.Fatal("SHOP_RESTORE_HEIGHT is not a number")
	}
	data, err := os.MkdirTemp(base, "3h-lookahead-")
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
	os.MkdirAll(filepath.Join(data, "bin"), 0o755)
	for _, f := range []string{"monero-wallet-rpc", "installed.json"} {
		b, err := os.ReadFile(filepath.Join(binDir, f))
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(data, "bin", f), b, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	cfg := config.Config{Site: "http://localhost:4321", Network: config.Stagenet, Address: addr, Node: "http://127.0.0.1:38081",
		DataDir: data, RestoreHeight: restore, AllowSameMachine: true}
	if err := cfg.Validate(); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Minute)
	defer cancel()

	sup, err := supervise.New(supervise.Options{Binary: filepath.Join(data, "bin", "monero-wallet-rpc"), DataDir: data, Network: cfg.Network, Node: cfg.Node})
	if err != nil {
		t.Fatal(err)
	}
	sctx, scancel := context.WithCancel(ctx)
	sdone := make(chan struct{})
	go func() { sup.Run(sctx); close(sdone) }()
	stopFirst := func() { scancel(); <-sdone }
	defer stopFirst()
	c, err := sup.WaitReady(ctx)
	if err != nil {
		t.Fatal(err)
	}
	node, err := noderpc.GetInfo(ctx, cfg.Node, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := wallet.Create(ctx, c, cfg, view, node); err != nil {
		t.Fatal(err)
	}
	stopFirst()
	h, err := defaultStartBridge(ctx, cfg, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	defer h.Stop()
	c, err = h.(*running).sup.WaitReady(ctx)
	if err != nil {
		t.Fatal(err)
	}
	synced := func(what string) {
		begin := time.Now()
		for {
			if height, err := c.GetHeight(ctx); err == nil && height+2 >= node.Height {
				t.Logf("%s: wallet at height %d after %v", what, height, time.Since(begin).Round(time.Second))
				return
			}
			if time.Since(begin) > 20*time.Minute {
				t.Fatalf("%s: wallet not synced", what)
			}
			time.Sleep(5 * time.Second)
		}
	}
	seen := func(what string) bool {
		ts, err := c.GetTransfers(ctx, []uint32{uint32(far)})
		if err != nil {
			t.Fatalf("%s: get_transfers: %v", what, err)
		}
		for _, tr := range ts {
			t.Logf("%s: index %d received %s atomic at height %d (pool %v)", what, tr.Index, tr.Amount, tr.Height, tr.Pool)
		}
		t.Logf("%s: payment to index %d seen: %v", what, far, len(ts) > 0)
		return len(ts) > 0
	}

	synced("1. restored from keys, default settings")
	seen("1. restored from keys, default settings")

	var top uint32
	for top < uint32(far) {
		a, err := c.CreateAddress(ctx, "stand-in")
		if err != nil {
			t.Fatal(err)
		}
		top = a.Index
	}
	t.Logf("2. created subaddresses up to index %d", top)
	time.Sleep(60 * time.Second) // at least two of wallet-rpc's 20 s auto-refreshes
	seen("2. after creating subaddresses up to the index, no rescan")

	// rescan_blockchain answers only when the rescan is done, which outlasts the bridge client's 5 s request timeout;
	// wallet-rpc carries on regardless, so a timeout here is expected. Then poll until the wallet answers again.
	begin := time.Now()
	if err := c.RescanBlockchain(ctx); err != nil {
		t.Logf("3. rescan_blockchain: %v (expected: the client gives up before the rescan finishes)", err)
	}
	for {
		ts, err := c.GetTransfers(ctx, []uint32{uint32(far)})
		if err == nil && len(ts) > 0 {
			t.Logf("3. after rescan_blockchain (%v): payment to index %d seen: true", time.Since(begin).Round(time.Second), far)
			for _, tr := range ts {
				t.Logf("3. index %d received %s atomic at height %d", tr.Index, tr.Amount, tr.Height)
			}
			return
		}
		if time.Since(begin) > 20*time.Minute {
			t.Fatalf("even 20 minutes after a rescan the payment to index %d isn't seen (last error %v)", far, err)
		}
		time.Sleep(10 * time.Second)
	}
}
