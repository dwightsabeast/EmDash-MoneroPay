package main

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/bridgeloop"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/config"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/noderpc"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/secret"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/supervise"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/syncclient"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/syncsign"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/wallet"
)

// switchableProxy forwards to the dev site and can be taken down (connection refused) and brought back on the
// same port, to stand in for the site being unreachable.
type switchableProxy struct {
	mu     sync.Mutex
	addr   string
	target *url.URL
	srv    *http.Server
}

func (p *switchableProxy) up(t *testing.T) {
	p.mu.Lock()
	defer p.mu.Unlock()
	ln, err := net.Listen("tcp", p.addr)
	if err != nil {
		t.Fatal(err)
	}
	p.addr = ln.Addr().String()
	rp := httputil.NewSingleHostReverseProxy(p.target)
	rp.Director = func(r *http.Request) {
		r.URL.Scheme, r.URL.Host, r.Host = p.target.Scheme, p.target.Host, p.target.Host
	}
	p.srv = &http.Server{Handler: rp}
	go p.srv.Serve(ln)
}

func (p *switchableProxy) down() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.srv.Close()
}

// TestLiveDevSite pairs the real bridge (view-only stagenet shop wallet, real wallet-rpc) with the running dev site
// and runs its sync loop: the pool fills with real subaddresses, a used code is refused, a restart reconciles, an
// outage backs off and recovers, and pairing again replaces the key. Run under scripts/with-shop-env.sh with
// XMR_BRIDGE_LIVE_BIN_DIR, XMR_BRIDGE_LIVE_DATA and XMR_BRIDGE_LIVE_SITE (the dev site, loopback) set. It removes
// what it created on the site (dev-e2e.mjs --cleanup-only) and the wallet copy. Stagenet only; no money moves.
func TestLiveDevSite(t *testing.T) {
	siteURL := os.Getenv("XMR_BRIDGE_LIVE_SITE")
	addr, binDir, base := os.Getenv("SHOP_ADDRESS"), os.Getenv("XMR_BRIDGE_LIVE_BIN_DIR"), os.Getenv("XMR_BRIDGE_LIVE_DATA")
	view := secret.New(os.Getenv("SHOP_VIEW_KEY"))
	os.Unsetenv("SHOP_VIEW_KEY")
	if siteURL == "" || addr == "" || view.IsEmpty() || binDir == "" || base == "" {
		t.Skip("run under scripts/with-shop-env.sh with XMR_BRIDGE_LIVE_SITE, XMR_BRIDGE_LIVE_BIN_DIR and XMR_BRIDGE_LIVE_DATA set")
	}
	restore, _ := strconv.ParseUint(os.Getenv("SHOP_RESTORE_HEIGHT"), 10, 64)
	target, err := url.Parse(siteURL)
	if err != nil {
		t.Fatal(err)
	}
	devE2E := filepath.Join("..", "..", "..", "scripts", "dev-e2e.mjs")
	issue := func(name string) string {
		file := filepath.Join(base, name)
		out, err := exec.Command("node", devE2E, "--issue-code", file).CombinedOutput()
		if err != nil {
			t.Fatalf("issuing a code: %v %s", err, out)
		}
		defer os.Remove(file)
		b, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		return strings.TrimSpace(string(b))
	}
	defer func() {
		out, err := exec.Command("node", devE2E, "--cleanup-only").CombinedOutput()
		t.Logf("dev site cleanup: %s %v", strings.TrimSpace(string(out)), err)
	}()

	data, err := os.MkdirTemp(base, "3d-live-")
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		os.RemoveAll(data)
		t.Log("temporary wallet directory deleted")
	}()
	proxy := &switchableProxy{addr: "127.0.0.1:0", target: target}
	proxy.up(t)
	defer proxy.down()

	cfg := config.Config{Site: "http://" + proxy.addr, Network: config.Stagenet, Address: addr, Node: "http://127.0.0.1:38081",
		DataDir: data, RestoreHeight: restore, AllowSameMachine: true}
	cfgFile := filepath.Join(data, "config")
	if err := config.Save(cfgFile, cfg); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()
	createShopWallet(t, ctx, cfg, binDir, view)

	// 1. Pair with a code issued as the admin page would.
	code1 := issue("3d-code1.txt")
	if c, out, errOut := run(ctx, "pair", "--config", cfgFile, "--code", code1); c != 0 {
		t.Fatalf("pair: %d %s %s", c, out, errOut)
	}
	key1, err := syncsign.LoadKey(keyFile(cfg))
	if err != nil {
		t.Fatal(err)
	}
	t.Log("paired with the dev site; key saved")
	// A used code can't be told from a wrong key: the site no longer reads the body first (contract README).
	if c, _, errOut := run(ctx, "pair", "--config", cfgFile, "--code", code1); c != 1 || !strings.Contains(errOut, "BAD_SIGNATURE") || !strings.Contains(errOut, "used or expired") {
		t.Fatalf("a used code: %d %s", c, errOut)
	}
	if k, _ := syncsign.LoadKey(keyFile(cfg)); !k.Equal(key1) {
		t.Fatal("a refused pairing replaced the key")
	}
	t.Log("the used code was refused (BAD_SIGNATURE, shown as 'used or expired'); the key is unchanged")

	// 2. Run: the pool fills to 50 real subaddresses.
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	h, err := defaultStartBridge(ctx, cfg, log)
	if err != nil {
		t.Fatal(err)
	}
	r := h.(*running)
	waitStatus(t, r, 3*time.Minute, "a full pool", func(st bridgeloop.Status) bool {
		return st.PoolTarget == 50 && st.PoolFree == 50 && st.Pending == 0 && st.LastError == ""
	})
	if c, out, _ := run(ctx, "status", "--config", cfgFile); c != 0 || !strings.Contains(out, "50 of 50") {
		t.Fatalf("status: %d %s", c, out)
	}
	t.Logf("pool full: 50 of 50 on the site; xmr-bridge status is healthy")

	// 3. Restart: reconcile, and no new addresses.
	h.Stop()
	before := r.loop.Status().LastSyncAt
	h, err = defaultStartBridge(ctx, cfg, log)
	if err != nil {
		t.Fatal(err)
	}
	r = h.(*running)
	waitStatus(t, r, 2*time.Minute, "a sync after restart", func(st bridgeloop.Status) bool {
		return st.LastSyncAt.After(before) && st.LastError == "" && st.PoolFree == 50
	})
	if st := r.loop.Status(); st.Pending != 0 {
		t.Fatalf("restart created addresses: %+v", st)
	}
	t.Log("restarted: synced again, pool still 50, nothing new created")

	// 4. The site goes away: backoff with the reason; it comes back: syncing resumes.
	proxy.down()
	waitStatus(t, r, 2*time.Minute, "an outage error", func(st bridgeloop.Status) bool {
		return strings.Contains(st.LastError, "can't be reached")
	})
	t.Logf("site down: %q", r.loop.Status().LastError)
	if c, out, _ := run(ctx, "status", "--config", cfgFile); c != 1 || !strings.Contains(out, "can't be reached") {
		t.Fatalf("status during the outage: %d %s", c, out)
	}
	downAt := time.Now()
	proxy.up(t)
	waitStatus(t, r, 2*time.Minute, "recovery", func(st bridgeloop.Status) bool { return st.LastError == "" && st.LastSyncAt.After(downAt) })
	t.Logf("site back: syncing again after %v", time.Since(downAt).Round(time.Second))

	// 5. Pair again (new code): the running bridge picks up the new key; the old key is refused.
	code2 := issue("3d-code2.txt")
	if c, out, errOut := run(ctx, "pair", "--config", cfgFile, "--code", code2); c != 0 {
		t.Fatalf("second pair: %d %s %s", c, out, errOut)
	}
	key2, _ := syncsign.LoadKey(keyFile(cfg))
	if key2.Equal(key1) {
		t.Fatal("pairing again kept the old key")
	}
	pairedAt := time.Now()
	r.Notify()
	waitStatus(t, r, 2*time.Minute, "a sync with the new key", func(st bridgeloop.Status) bool { return st.LastError == "" && st.LastSyncAt.After(pairedAt) })
	_, err = siteClient(cfg).Send(ctx, key1, syncclient.Body{V: 1, Seq: time.Now().UnixMilli()})
	var se *syncclient.Error
	if !errors.As(err, &se) || se.Code != "BAD_SIGNATURE" {
		t.Fatalf("the old key: %v", err)
	}
	t.Log("paired again: the running bridge synced with the new key; the old key gets BAD_SIGNATURE")
	h.Stop()
	if st := r.sup.Status(); st.Running {
		t.Fatal("wallet-rpc still running")
	}
}

func waitStatus(t *testing.T, r *running, limit time.Duration, what string, cond func(bridgeloop.Status) bool) {
	t.Helper()
	for deadline := time.Now().Add(limit); !cond(r.loop.Status()); time.Sleep(time.Second) {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s: %+v", what, r.loop.Status())
		}
	}
}

// createShopWallet copies the verified wallet-rpc into cfg.DataDir/bin and creates the view-only wallet there.
func createShopWallet(t *testing.T, ctx context.Context, cfg config.Config, binDir string, view secret.String) {
	t.Helper()
	os.MkdirAll(filepath.Join(cfg.DataDir, "bin"), 0o755)
	for _, f := range []string{"monero-wallet-rpc", "installed.json"} {
		b, err := os.ReadFile(filepath.Join(binDir, f))
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(cfg.DataDir, "bin", f), b, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	sup, err := supervise.New(supervise.Options{Binary: filepath.Join(cfg.DataDir, "bin", "monero-wallet-rpc"), DataDir: cfg.DataDir, Network: cfg.Network, Node: cfg.Node})
	if err != nil {
		t.Fatal(err)
	}
	sctx, scancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() { sup.Run(sctx); close(done) }()
	defer func() { scancel(); <-done }()
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
}
