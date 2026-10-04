package main

import (
	"context"
	"crypto/ed25519"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"sync"
	"time"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/bridgeloop"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/config"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/hashsig"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/monerodl"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/supervise"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/syncsign"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/wallet"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/walletrpc"
)

// bridgeHandle is a started bridge: Notify asks for an immediate sync, Stop stops it and waits.
type bridgeHandle interface {
	Notify()
	Stop()
}

// startBridge is replaced in tests.
var startBridge = defaultStartBridge

type running struct {
	cancel context.CancelFunc
	done   chan struct{}
	sup    *supervise.Supervisor
	loop   *bridgeloop.Loop
}

func (r *running) Notify() { r.loop.Notify() }

func (r *running) Stop() {
	r.cancel()
	<-r.done
}

// defaultStartBridge checks the wallet exists (before any network use), installs a verified monero-wallet-rpc if
// none is installed, and supervises it, opening the wallet on every start.
func defaultStartBridge(ctx context.Context, cfg config.Config, log *slog.Logger) (bridgeHandle, error) {
	if !wallet.Exists(cfg.DataDir) {
		return nil, wallet.ErrNoWallet
	}
	binDir := filepath.Join(cfg.DataDir, "bin")
	if _, err := monerodl.ReadInstalled(binDir); err != nil {
		if err := installWalletRPC(ctx, binDir, log); err != nil {
			return nil, err
		}
	}
	exe, err := os.Executable()
	if err != nil {
		return nil, err
	}
	sup, err := supervise.New(supervise.Options{
		Binary:        filepath.Join(binDir, monerodl.BinaryName),
		DataDir:       cfg.DataDir,
		Network:       cfg.Network,
		Node:          cfg.Node,
		NotifyCommand: []string{exe, "notify", "--pid", strconv.Itoa(os.Getpid())},
		Log:           log,
		Init:          func(ctx context.Context, c *walletrpc.Client) error { return wallet.Open(ctx, c, cfg) },
	})
	if err != nil {
		return nil, err
	}
	loop, err := bridgeloop.New(bridgeloop.Options{
		Wallet:  func(ctx context.Context) (bridgeloop.Wallet, error) { return sup.WaitReady(ctx) },
		Site:    siteClient(cfg),
		LoadKey: func() (ed25519.PrivateKey, error) { return syncsign.LoadKey(keyFile(cfg)) },
		DataDir: cfg.DataDir,
		Log:     log,
		Extra:   func() any { return sup.Status() },
	})
	if err != nil {
		return nil, err
	}
	rctx, cancel := context.WithCancel(ctx)
	r := &running{cancel: cancel, done: make(chan struct{}), sup: sup, loop: loop}
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); sup.Run(rctx) }()
	go func() { defer wg.Done(); loop.Run(rctx) }()
	go func() { wg.Wait(); close(r.done) }()
	go func() {
		c, err := sup.WaitReady(rctx)
		if err != nil {
			return
		}
		hctx, cancel := context.WithTimeout(rctx, 10*time.Second)
		defer cancel()
		if h, err := c.GetHeight(hctx); err == nil {
			log.Info("wallet open", "height", h)
		}
	}()
	return r, nil
}

func installWalletRPC(ctx context.Context, binDir string, log *slog.Logger) error {
	arch, err := monerodl.ArchFor(runtime.GOARCH)
	if err != nil {
		return err
	}
	f := &monerodl.Fetcher{HashesURL: monerodl.DefaultHashesURL, ArchiveBase: monerodl.DefaultArchiveBase, Key: hashsig.MoneroReleaseKey, Arch: arch}
	rel, err := f.Latest(ctx)
	if err != nil {
		return err
	}
	log.Info("downloading monero-wallet-rpc", "release", rel.Name)
	inst, err := f.Install(ctx, rel, binDir)
	if err != nil {
		return err
	}
	log.Info("installed monero-wallet-rpc", "version", inst.Version, "sha256", inst.BinarySHA256)
	return nil
}
