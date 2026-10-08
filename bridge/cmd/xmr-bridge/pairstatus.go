package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/bridgeloop"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/config"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/crosscheck"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/installer"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/noderpc"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/pairing"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/selfupdate"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/syncclient"
)

func keyFile(cfg config.Config) string { return filepath.Join(cfg.DataDir, "bridge.key") }

// isRoot and chownKey are replaced in tests.
var (
	isRoot   = func() bool { return os.Geteuid() == 0 }
	chownKey = func(path string) error {
		uid, gid, ok, err := installer.RealSystem().LookupUser(installer.ServiceUser)
		if err != nil || !ok {
			return fmt.Errorf("the %s user isn't there: %v", installer.ServiceUser, err)
		}
		return os.Chown(path, uid, gid)
	}
)

func siteClient(cfg config.Config) *syncclient.Client {
	return &syncclient.Client{Site: cfg.Site, UserAgent: "xmr-bridge/" + version}
}

// cmdPair pairs with the site using the one-time code from the admin page's Connect wallet host button. The
// installer runs the same step; a running bridge picks up the new key at its next sync.
func cmdPair(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("pair", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	path := fs.String("config", "", "config file")
	code := fs.String("code", "", "the one-time pairing code")
	if err := fs.Parse(args); err != nil || fs.NArg() != 0 || *path == "" || *code == "" {
		fmt.Fprint(stderr, usage)
		return 2
	}
	cfg, err := config.Load(*path)
	if err != nil {
		fmt.Fprintf(stderr, "xmr-bridge: %v\n", err)
		return 1
	}
	if err := selfupdate.CheckFormat(cfg.DataDir); err != nil {
		fmt.Fprintf(stderr, "xmr-bridge: %v\n", err)
		return 1
	}
	if err := os.MkdirAll(cfg.DataDir, 0o700); err != nil {
		fmt.Fprintf(stderr, "xmr-bridge: %v\n", err)
		return 1
	}
	var height uint64
	nctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	if info, err := noderpc.GetInfo(nctx, cfg.Node, nil); err == nil {
		height = info.Height
	}
	cancel()
	if err := pairing.Pair(ctx, siteClient(cfg), *code, keyFile(cfg), height, time.Now()); err != nil {
		fmt.Fprintf(stderr, "xmr-bridge: pairing failed: %v\n", err)
		return 1
	}
	if isRoot() {
		if err := chownKey(keyFile(cfg)); err != nil {
			fmt.Fprintf(stderr, "xmr-bridge: paired, but the key couldn't be handed to the service account: %v\n", err)
			return 1
		}
	}
	fmt.Fprintf(stdout, "Paired with %s. The site's Monero payments page now shows the wallet host as connected.\n", cfg.Site)
	return 0
}

// staleAfter: a running bridge attempts a sync at least every 5 minutes (its longest backoff).
const staleAfter = 6 * time.Minute

// cmdStatus prints what the running bridge last recorded, in plain words with the fix for each problem. Exit 0 when
// healthy, 1 otherwise.
func cmdStatus(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("status", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	path := fs.String("config", "", "config file")
	if err := fs.Parse(args); err != nil || fs.NArg() != 0 || *path == "" {
		fmt.Fprint(stderr, usage)
		return 2
	}
	cfg, err := config.Load(*path)
	if err != nil {
		fmt.Fprintf(stderr, "xmr-bridge: %v\n", err)
		return 1
	}
	if err := selfupdate.CheckFormat(cfg.DataDir); err != nil {
		fmt.Fprintf(stderr, "xmr-bridge: %v\n", err)
		return 1
	}
	healthy := true
	fmt.Fprintf(stdout, "Site:       %s\nNetwork:    %s\n", cfg.Site, cfg.Network)
	if _, err := os.Stat(keyFile(cfg)); err == nil {
		fmt.Fprintln(stdout, "Paired:     yes")
	} else {
		healthy = false
		fmt.Fprintln(stdout, "Paired:     no: this wallet host is not paired yet. On the site's Monero payments page, press Connect wallet host and run the command it shows")
	}
	st, err := bridgeloop.ReadStatus(cfg.DataDir)
	switch {
	case errors.Is(err, os.ErrNotExist):
		fmt.Fprintln(stdout, "Last sync:  never (the bridge hasn't run yet; check with: systemctl status xmr-bridge)")
		return 1
	case err != nil:
		fmt.Fprintf(stdout, "Last sync:  unknown (%v)\n", err)
		return 1
	}
	now := time.Now()
	// While the wallet catches up to the site's addresses (spec change 15), the sync loop waits for it: a quiet
	// status file is expected then, not a sign of a stopped bridge.
	catching := st.CatchUp != nil
	if st.LastSyncAt.IsZero() {
		fmt.Fprintln(stdout, "Last sync:  never")
		healthy = healthy && catching
	} else {
		fmt.Fprintf(stdout, "Last sync:  %s ago\n", now.Sub(st.LastSyncAt).Round(time.Second))
	}
	if !catching && now.Sub(st.LastAttemptAt) > staleAfter {
		healthy = false
		fmt.Fprintf(stdout, "Problem:    the bridge hasn't tried to sync for %s. Is it running? Check with: systemctl status xmr-bridge\n", now.Sub(st.LastAttemptAt).Round(time.Second))
	}
	if st.LastError != "" {
		healthy = false
		fmt.Fprintf(stdout, "Problem:    %s\n", st.LastError)
	}
	switch c := st.CatchUp; {
	case c == nil:
	case c.Rescanning:
		fmt.Fprintf(stdout, "Catching up: rescanning the wallet for payments to its %d addresses. Payments are reported when it finishes\n", c.Addresses)
	default:
		fmt.Fprintf(stdout, "Catching up: creating the site's payment addresses in this wallet (%d of %d), then one rescan\n", c.Addresses, c.Target)
	}
	switch nc := st.NodeCheck; nc.State {
	case "", crosscheck.Off:
		fmt.Fprintln(stdout, "Node check: off (the node is your own)")
	case crosscheck.OK:
		fmt.Fprintf(stdout, "Node check: ok%s\n", via(nc.Node))
	case crosscheck.Unavailable:
		fmt.Fprintf(stdout, "Node check: unavailable: %s\n", nc.Detail)
	case crosscheck.Mismatch:
		healthy = false
		fmt.Fprintf(stdout, "Node check: MISMATCH: %s\n", nc.Detail)
	}
	fmt.Fprintf(stdout, "Wallet:     height %d\n", st.WalletHeight)
	fmt.Fprintf(stdout, "Addresses:  %d of %d ready on the site", st.PoolFree, st.PoolTarget)
	if st.Pending > 0 {
		fmt.Fprintf(stdout, " (%d more waiting to be sent)", st.Pending)
	}
	fmt.Fprintf(stdout, "\nWatching:   %d payment address(es)\n", st.Watching)
	if st.Updates != "" {
		fmt.Fprintf(stdout, "Updates:    %s\n", st.Updates)
	}
	for _, w := range st.Warnings {
		fmt.Fprintf(stdout, "Warning:    %s\n", w)
	}
	if !healthy {
		return 1
	}
	return 0
}

func via(node string) string {
	if node == "" {
		return ""
	}
	return " (checked with " + node + ")"
}
