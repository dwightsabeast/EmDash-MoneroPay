// Command xmr-bridge is the wallet host's half of xmr-pay: it runs Monero's monero-wallet-rpc with a view-only
// wallet and pushes signed snapshots to the site. Commands: version, run (install and supervise wallet-rpc, open
// the wallet, sync), pair, status and notify.
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
	"strconv"
	"syscall"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/config"
)

// version is set at build time with -ldflags "-X main.version=…".
var version = "dev"

const usage = `usage:
  xmr-bridge install --site <site URL> --pair <one-time code> [--node <URL>] [--restore-height <n>] [--no-auto-update]
  xmr-bridge uninstall [--delete-data]
  xmr-bridge version
  xmr-bridge run --config <file>
  xmr-bridge pair --config <file> --code <one-time code>
  xmr-bridge status --config <file>
  xmr-bridge notify --pid <bridge pid> [txid]   (run by monero-wallet-rpc's --tx-notify)
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
	case "notify":
		return cmdNotify(args[1:], stderr)
	case "install":
		return cmdInstall(ctx, args[1:], stdout, stderr)
	case "uninstall":
		return cmdUninstall(args[1:], stdout, stderr)
	case "pair":
		return cmdPair(ctx, args[1:], stdout, stderr)
	case "status":
		return cmdStatus(args[1:], stdout, stderr)
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
	// SIGUSR1 comes from `xmr-bridge notify` (wallet-rpc's --tx-notify). Taken from the start: Go's default for
	// it is to exit. The sync loop (3d) syncs on it; for now it is logged.
	notified := make(chan os.Signal, 1)
	signal.Notify(notified, syscall.SIGUSR1)
	defer signal.Stop(notified)
	log.Info("starting", "version", version, "network", string(cfg.Network), "site", cfg.Site, "node", cfg.Node)
	b, err := startBridge(ctx, cfg, log)
	if err != nil {
		log.Error("cannot start", "err", err)
		return 1
	}
	for {
		select {
		case <-ctx.Done():
			b.Stop()
			log.Info("stopped")
			return 0
		case <-notified:
			log.Info("notified")
			b.Notify()
		case ev := <-b.Updates():
			log.Info("update", "what", ev.reason)
			b.Stop() // wallet-rpc stops before any file is swapped
			if err := ev.apply(); err != nil {
				log.Error("update", "err", err)
			}
			log.Info("restarting for the update")
			return exitForUpdate
		}
	}
}

// cmdNotify is what monero-wallet-rpc runs for each new incoming transaction (--tx-notify): it sends SIGUSR1 to
// the bridge that started it, which syncs at once. The txid wallet-rpc appends is checked but not needed.
func cmdNotify(args []string, stderr io.Writer) int {
	fs := flag.NewFlagSet("notify", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	pidText := fs.String("pid", "", "the bridge's process id")
	if err := fs.Parse(args); err != nil || fs.NArg() > 1 {
		fmt.Fprint(stderr, usage)
		return 2
	}
	pid, err := strconv.Atoi(*pidText)
	if err != nil || pid <= 1 {
		fmt.Fprint(stderr, "xmr-bridge notify: --pid must be the bridge's process id\n")
		return 2
	}
	if fs.NArg() == 1 && !isTxID(fs.Arg(0)) {
		fmt.Fprint(stderr, "xmr-bridge notify: not a transaction id\n")
		return 2
	}
	if err := syscall.Kill(pid, syscall.SIGUSR1); err != nil {
		fmt.Fprintf(stderr, "xmr-bridge notify: %v\n", err)
		return 1
	}
	return 0
}

func isTxID(s string) bool {
	if len(s) != 64 {
		return false
	}
	for i := 0; i < len(s); i++ {
		if !('0' <= s[i] && s[i] <= '9' || 'a' <= s[i] && s[i] <= 'f') {
			return false
		}
	}
	return true
}
