package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"syscall"
	"time"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/config"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/installer"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/monerodl"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/noderpc"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/pairing"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/secret"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/supervise"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/wallet"
)

// cmdInstall is what install.sh hands off to, and the spec's cautious path. It asks for the shop wallet's address
// and view key on the terminal, never on the command line.
func cmdInstall(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("install", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	site := fs.String("site", "", "the EmDash site's address")
	code := fs.String("pair", "", "the one-time pairing code")
	node := fs.String("node", "", "a Monero node to use (default: your own node on this machine, else asked)")
	restore := fs.Uint64("restore-height", 0, "scan from this height (default: today)")
	noUpdate := fs.Bool("no-auto-update", false, "don't install updates automatically")
	sameMachine := fs.Bool("allow-same-machine", false, "development only, stagenet only")
	if err := fs.Parse(args); err != nil || fs.NArg() != 0 || *site == "" || *code == "" {
		fmt.Fprint(stderr, usage)
		return 2
	}
	sys := installer.RealSystem()
	if sys.Euid() != 0 {
		fmt.Fprintln(stderr, "xmr-bridge: the installer needs root: run it with sudo")
		return 1
	}
	exe, err := os.Executable()
	if err != nil {
		fmt.Fprintf(stderr, "xmr-bridge: %v\n", err)
		return 1
	}
	tty, closeTTY, err := installer.OpenTTY()
	if err != nil {
		fmt.Fprintf(stderr, "xmr-bridge: %v\n", err)
		return 1
	}
	defer closeTTY()
	log := slog.New(slog.NewTextHandler(stderr, &slog.HandlerOptions{Level: slog.LevelWarn}))
	opts := installer.Options{Paths: installer.Paths{Root: "/"}, Site: *site, Code: *code, Node: *node, RestoreHeight: *restore,
		NoAutoUpdate: *noUpdate, AllowSameMachine: *sameMachine, Exe: exe}
	if err := installer.Install(ctx, opts, sys, tty, installSteps(log)); err != nil {
		fmt.Fprintf(stderr, "xmr-bridge: install stopped: %v\n", err)
		return 1
	}
	return 0
}

func installSteps(log *slog.Logger) installer.Steps {
	return installer.Steps{
		NodeInfo: func(ctx context.Context, u string) (noderpc.Info, error) {
			c, cancel := context.WithTimeout(ctx, 10*time.Second)
			defer cancel()
			return noderpc.GetInfo(c, u, nil)
		},
		SameMachine:      installer.NewDetector().Signals,
		InstallWalletRPC: func(ctx context.Context, binDir string) error { return installWalletRPC(ctx, binDir, log) },
		CreateWallet:     createWallet,
		Pair: func(ctx context.Context, cfg config.Config, code string) (uint64, error) {
			var height uint64
			if info, err := noderpc.GetInfo(ctx, cfg.Node, nil); err == nil {
				height = info.Height
			}
			return pairing.Pair(ctx, siteClient(cfg), code, keyFile(cfg), height, time.Now())
		},
	}
}

// createWallet runs wallet-rpc as the service account just long enough to create the view-only wallet.
func createWallet(ctx context.Context, cfg config.Config, view secret.String, cred *syscall.Credential) error {
	sup, err := supervise.New(supervise.Options{
		Binary:     filepath.Join(cfg.DataDir, "bin", monerodl.BinaryName),
		DataDir:    cfg.DataDir,
		Network:    cfg.Network,
		Node:       cfg.Node,
		Credential: cred,
	})
	if err != nil {
		return err
	}
	sctx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() { sup.Run(sctx); close(done) }()
	defer func() { cancel(); <-done }()
	wctx, wcancel := context.WithTimeout(ctx, 2*time.Minute)
	defer wcancel()
	c, err := sup.WaitReady(wctx)
	if err != nil {
		return fmt.Errorf("Monero's wallet program didn't start: %w (%s)", err, sup.Status().LastExit)
	}
	node, err := noderpc.GetInfo(ctx, cfg.Node, nil)
	if err != nil {
		return err
	}
	return wallet.Create(ctx, c, cfg, view, node)
}

func cmdUninstall(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("uninstall", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	deleteData := fs.Bool("delete-data", false, "also delete the view-only wallet, the bridge key and the config")
	if err := fs.Parse(args); err != nil || fs.NArg() != 0 {
		fmt.Fprint(stderr, usage)
		return 2
	}
	if err := installer.Uninstall(installer.Paths{Root: "/"}, *deleteData, installer.RealSystem(), stdout); err != nil {
		fmt.Fprintf(stderr, "xmr-bridge: %v\n", err)
		return 1
	}
	return 0
}
