// Command xmr-bridge is the wallet host's half of xmr-pay: it runs Monero's monero-wallet-rpc with a view-only
// wallet and pushes signed snapshots to the site. This is the phase 03a skeleton: version and run (config and
// logging only; the sync loop comes in 3d).
package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"runtime"
	"syscall"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/config"
)

// version is set at build time with -ldflags "-X main.version=…".
var version = "dev"

const usage = `usage:
  xmr-bridge version
  xmr-bridge run --config <file>
`

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	code := realMain(ctx, os.Args[1:], os.Stdout, os.Stderr)
	stop()
	os.Exit(code)
}

func realMain(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprint(stderr, usage)
		return 2
	}
	switch args[0] {
	case "version":
		fmt.Fprintf(stdout, "xmr-bridge %s (%s, %s/%s)\n", version, runtime.Version(), runtime.GOOS, runtime.GOARCH)
		return 0
	case "run":
		return cmdRun(ctx, args[1:], stderr)
	default:
		fmt.Fprint(stderr, usage)
		return 2
	}
}

func cmdRun(ctx context.Context, args []string, stderr io.Writer) int {
	fs := flag.NewFlagSet("run", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	path := fs.String("config", "", "config file")
	if err := fs.Parse(args); err != nil || fs.NArg() != 0 {
		fmt.Fprint(stderr, usage)
		return 2
	}
	if *path == "" {
		fmt.Fprint(stderr, "xmr-bridge run: --config is required\n"+usage)
		return 2
	}
	cfg, err := config.Load(*path)
	if err != nil {
		fmt.Fprintf(stderr, "xmr-bridge: %v\n", err)
		return 1
	}
	// Text logs to stderr; systemd's journal adds timestamps. Secrets are secret.String and print as [redacted].
	log := slog.New(slog.NewTextHandler(stderr, &slog.HandlerOptions{
		ReplaceAttr: func(_ []string, a slog.Attr) slog.Attr {
			if a.Key == slog.TimeKey {
				return slog.Attr{}
			}
			return a
		},
	}))
	log.Info("starting", "version", version, "network", string(cfg.Network), "site", cfg.Site, "node", cfg.Node)
	<-ctx.Done()
	log.Info("stopped")
	return 0
}
