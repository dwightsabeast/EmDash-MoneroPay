package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"path/filepath"
	"runtime"
	"sync"
	"time"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/config"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/hashsig"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/moneroaddr"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/monerodl"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/selfupdate"
)

// exitForUpdate is the exit code that tells systemd to start the service again (RestartForceExitStatus=75), after
// an update or a rollback has been swapped in.
const exitForUpdate = 75

// updateEvent asks run to stop the bridge (wallet-rpc stopped), apply a file swap, and exit for a restart.
type updateEvent struct {
	reason string
	apply  func() error
}

// updateStatus is the text `xmr-bridge status` shows about updates.
type updateStatus struct {
	mu   sync.Mutex
	text string
}

func (u *updateStatus) set(s string) { u.mu.Lock(); u.text = s; u.mu.Unlock() }
func (u *updateStatus) get() string  { u.mu.Lock(); defer u.mu.Unlock(); return u.text }

// startUpdates watches a pending update, then (with automatic updates on) checks daily for new bridge and wallet-rpc
// releases. It never swaps files itself: it sends an updateEvent and run does it with wallet-rpc stopped.
func startUpdates(ctx context.Context, cfg config.Config, r *running, log *slog.Logger) {
	files := selfupdate.Files{DataDir: cfg.DataDir}
	go func() {
		if p, ok := files.Pending(); ok {
			r.updateText.set(fmt.Sprintf("checking the update to %s %s", p.Kind, p.Version))
			if !watchPending(ctx, files, p, r, log) {
				return
			}
		}
		if !cfg.AutoUpdate {
			r.updateText.set("off (installed with --no-auto-update)")
			return
		}
		r.updateText.set("on")
		wait := firstCheckAfter
		for {
			select {
			case <-ctx.Done():
				return
			case <-time.After(wait):
			}
			if ev := checkOnce(ctx, cfg, r, files, log); ev != nil {
				select {
				case r.updates <- *ev:
				case <-ctx.Done():
				}
				return
			}
			wait = checkEvery
			if checkJitter > 0 {
				wait += time.Duration(rand.Int64N(int64(checkJitter)))
			}
		}
	}()
}

// watchPending decides about an update that has just been swapped in (Wyatt's 3g rules, selfupdate.Decide). It
// returns true once the update is committed, false after asking for a rollback or when ctx ends.
func watchPending(ctx context.Context, files selfupdate.Files, p selfupdate.Pending, r *running, log *slog.Logger) bool {
	opened := false
	tick := time.NewTicker(15 * time.Second)
	defer tick.Stop()
	for {
		st := r.sup.Status()
		if st.Ready && !opened {
			opened = true
			files.MarkStarted() // earlier failed starts no longer count for the guard
		}
		ls := r.loop.Status()
		h := selfupdate.Health{WalletOpen: opened, WalletRPCRestarts: st.Restarts, Synced: ls.Synced, SiteRefused: ls.SiteRefused, Unreachable: ls.Unreachable}
		switch selfupdate.Decide(p, h, time.Now()) {
		case selfupdate.Commit:
			files.ClearPending()
			log.Info("update confirmed", "kind", p.Kind, "version", p.Version)
			r.updateText.set(fmt.Sprintf("updated %s to %s", p.Kind, p.Version))
			return true
		case selfupdate.RollBack:
			reason := fmt.Sprintf("the update to %s %s didn't work; rolling back to %s and refusing %s", p.Kind, p.Version, p.Previous, p.Version)
			select {
			case r.updates <- updateEvent{reason: reason, apply: func() error { return selfupdate.Rollback(files, p) }}:
			case <-ctx.Done():
			}
			return false
		}
		select {
		case <-ctx.Done():
			return false
		case <-tick.C:
		}
	}
}

// checkOnce looks for a bridge release, then a wallet-rpc release. A development build only updates on stagenet,
// judged from the address of the wallet wallet-rpc has open (never from the config).
func checkOnce(ctx context.Context, cfg config.Config, r *running, files selfupdate.Files, log *slog.Logger) *updateEvent {
	if devBuild {
		wctx, cancel := context.WithTimeout(ctx, 30*time.Second)
		c, err := r.sup.WaitReady(wctx)
		cancel()
		if err != nil {
			return nil
		}
		if err := stagenetWallet(ctx, c.GetAddress); err != nil {
			r.updateText.set("off: " + err.Error())
			return nil
		}
	}
	arch, _ := monerodl.ArchFor(runtime.GOARCH)
	u := &selfupdate.Updater{
		BaseURL: releaseBase(), Keys: releaseKeys(), Delay: updateDelay, WalletRPCDelay: walletRPCDelay,
		Current: version, Arch: runtime.GOARCH, DataDir: cfg.DataDir,
		Monero: &monerodl.Fetcher{HashesURL: monerodl.DefaultHashesURL, ArchiveBase: monerodl.DefaultArchiveBase, Key: hashsig.MoneroReleaseKey, Arch: arch},
	}
	p, err := u.PrepareBridge(ctx)
	switch {
	case errors.Is(err, selfupdate.ErrNoKey):
		r.updateText.set("bridge updates off: no release key pinned yet; Monero wallet program updates on")
	case err != nil:
		log.Warn("checking for a bridge update", "err", err)
	case p != nil:
		return &updateEvent{reason: fmt.Sprintf("updating the bridge from %s to %s", p.Previous, p.Version), apply: func() error { return p.Apply(files, time.Now()) }}
	}
	inst, err := monerodl.ReadInstalled(filepath.Join(cfg.DataDir, "bin"))
	if err != nil {
		return nil
	}
	pw, err := u.PrepareWalletRPC(ctx, inst.Version)
	if err != nil {
		log.Warn("checking for a Monero wallet program update", "err", err)
		return nil
	}
	if pw != nil {
		return &updateEvent{reason: fmt.Sprintf("updating Monero's wallet program from %s to %s (wallet files backed up)", pw.Previous, pw.Version), apply: func() error { return pw.Apply(files, time.Now()) }}
	}
	return nil
}

// stagenetWallet allows a development-build update only when the wallet wallet-rpc has open is a stagenet wallet,
// read from its address (never from the config).
func stagenetWallet(ctx context.Context, getAddress func(context.Context) (string, error)) error {
	addr, err := getAddress(ctx)
	if err != nil {
		return fmt.Errorf("can't read the open wallet's address: %w", err)
	}
	net, _, err := moneroaddr.Parse(addr)
	if err != nil || net != "stagenet" {
		return errors.New("a development build updates only on stagenet")
	}
	return nil
}
