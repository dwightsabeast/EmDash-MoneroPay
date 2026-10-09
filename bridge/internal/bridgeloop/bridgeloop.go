// Package bridgeloop is the bridge's sync loop (spec, Bridge service, duties 2 to 5): every 12 to 15 seconds, and
// at once when wallet-rpc reports a transaction, it reads the watched subaddresses' incoming transfers and posts a
// signed snapshot to the site; it tops up the site's address pool; and after a start it reconciles (the first sync
// learns the watch list, the next reports every watched index). It keeps no state between starts except subaddresses
// created but not yet acknowledged by the site (run/pending.json), so a restart never leaves them unused, and an
// unfinished catch-up (run/catchup.json, spec change 15): a wallet restored from keys lacks the subaddresses the site
// already holds, so before it reports anything it creates them up to the site's poolTop and rescans once.
package bridgeloop

import (
	"context"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/sitetext"
	"io"
	"log/slog"
	"math/rand/v2"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/crosscheck"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/syncclient"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/walletrpc"
)

const (
	maxSnapshots  = 100 // the plugin's caps per request
	maxAddresses  = 100
	maxTransfers  = 32
	addressLabel  = "coffer"
	walletTimeout = 30 * time.Second
	createBatch   = 100            // subaddresses per create_address call while catching up
	rescanLimit   = 24 * time.Hour // a rescan from the restore height; ctx (shutdown) ends it sooner
	// The wallet check (phase 04): behind when its node is more than walletBehind blocks ahead; the node is asked for
	// its height at most every nodeHeightEvery.
	walletBehind    = 5
	nodeHeightEvery = time.Minute
)

// Wallet is what the loop needs from wallet-rpc (*walletrpc.Client).
type Wallet interface {
	GetHeight(ctx context.Context) (uint64, error)
	GetTransfers(ctx context.Context, indexes []uint32) ([]walletrpc.Transfer, error)
	CreateAddress(ctx context.Context, label string) (walletrpc.NewAddress, error)
	CreateAddresses(ctx context.Context, label string, n int) ([]walletrpc.NewAddress, error)
	HasSubaddress(ctx context.Context, index uint32) (bool, error)
	RescanBlockchain(ctx context.Context) error
}

// CrossChecker confirms mined transfers against a second node (*crosscheck.Checker); nil when the node is the
// shop's own.
type CrossChecker interface {
	Check(ctx context.Context, ts []walletrpc.Transfer) ([]walletrpc.Transfer, crosscheck.Report)
}

// Sender posts one request to the site (*syncclient.Client).
type Sender interface {
	Send(ctx context.Context, key ed25519.PrivateKey, body syncclient.Body) (syncclient.Response, error)
}

// Options configures the loop. Zero durations take the defaults.
type Options struct {
	Wallet func(ctx context.Context) (Wallet, error) // waits until wallet-rpc is ready with the wallet open
	Site   Sender
	Key    ed25519.PrivateKey
	// LoadKey, when set, reads the key for every sync instead of Key (so pairing again needs no restart).
	LoadKey func() (ed25519.PrivateKey, error)
	DataDir string
	Log     *slog.Logger
	Now     func() time.Time
	// Extra is merged into the status file (wallet-rpc's state).
	Extra func() any
	// CrossCheck, when set, adjusts confirmations of mined transfers (spec change 13).
	CrossCheck CrossChecker
	// Updates, when set, describes the update state for the status file.
	Updates func() string
	// NodeHeight, when set, reads the node's chain height for the wallet check sent to the site.
	NodeHeight func(ctx context.Context) (uint64, error)

	Interval   time.Duration // default 12 s
	Jitter     time.Duration // default 3 s
	Debounce   time.Duration // default 1 s after a notify
	BackoffMin time.Duration // default 15 s
	BackoffMax time.Duration // default 5 min
}

// Status is written to <dataDir>/run/status.json after every sync attempt and read by `xmr-bridge status`.
type Status struct {
	LastAttemptAt time.Time         `json:"lastAttemptAt"`
	LastSyncAt    time.Time         `json:"lastSyncAt"`
	LastError     string            `json:"lastError,omitempty"`
	WalletHeight  uint64            `json:"walletHeight"`
	PoolFree      int               `json:"poolFree"`
	PoolTarget    int               `json:"poolTarget"`
	Watching      int               `json:"watching"`
	Pending       int               `json:"pending"`
	Warnings      []string          `json:"warnings,omitempty"`
	NodeCheck     crosscheck.Report `json:"nodeCheck"`
	// What the site did with the syncs sent since this process started (for the update rule).
	Synced      int    `json:"synced"`
	SiteRefused int    `json:"siteRefused"`
	Unreachable int    `json:"unreachable"`
	Updates     string `json:"updates,omitempty"`
	WalletRPC   any    `json:"walletRpc,omitempty"`
	// CatchUp is set while the wallet is being caught up to the site's pool (spec change 15).
	CatchUp *CatchUp `json:"catchUp,omitempty"`
}

// CatchUp is the progress of a catch-up: subaddresses created up to Target, then one rescan.
type CatchUp struct {
	Target     uint32 `json:"target"`
	Addresses  uint32 `json:"addresses"` // the wallet's highest subaddress index so far (0 until the first one)
	Rescanning bool   `json:"rescanning"`
}

// Loop is one bridge's sync loop.
type Loop struct {
	o      Options
	notify chan struct{}

	mu      sync.Mutex
	watch   []uint32 // nil until the first sync after start
	cursor  int
	pending []syncclient.Address
	lastSeq int64
	soon    bool
	st      Status
	// Spec change 15: the highest index the wallet is known to have, the site's last poolTop, and the target of an
	// unfinished catch-up (0 when none).
	known   uint32
	poolTop uint32
	catchup uint32
	// The wallet check's last node answer and when it was asked.
	nodeAt     time.Time
	nodeHeight uint64
	nodeErr    error
}

// New loads any pending addresses from a previous run.
func New(o Options) (*Loop, error) {
	def := func(d *time.Duration, v time.Duration) {
		if *d <= 0 {
			*d = v
		}
	}
	def(&o.Interval, 12*time.Second)
	def(&o.Jitter, 3*time.Second)
	def(&o.Debounce, time.Second)
	def(&o.BackoffMin, 15*time.Second)
	def(&o.BackoffMax, 5*time.Minute)
	if o.Log == nil {
		o.Log = slog.New(slog.NewTextHandler(io.Discard, nil))
	}
	if o.Now == nil {
		o.Now = time.Now
	}
	l := &Loop{o: o, notify: make(chan struct{}, 1)}
	l.st.NodeCheck = crosscheck.Report{State: crosscheck.Off, Detail: "the configured node is your own"}
	if o.CrossCheck != nil {
		l.st.NodeCheck = crosscheck.Report{State: crosscheck.OK, Detail: "no mined payments checked yet"}
	}
	if err := os.MkdirAll(l.runDir(), 0o700); err != nil {
		return nil, err
	}
	if err := os.Chmod(l.runDir(), 0o700); err != nil {
		return nil, err
	}
	data, err := os.ReadFile(l.pendingFile())
	switch {
	case err == nil:
		if err := json.Unmarshal(data, &l.pending); err != nil {
			return nil, fmt.Errorf("bridgeloop: %s: %w", l.pendingFile(), err)
		}
	case !errors.Is(err, os.ErrNotExist):
		return nil, err
	}
	data, err = os.ReadFile(l.catchUpFile())
	switch {
	case err == nil:
		var m struct {
			Target uint32 `json:"target"`
		}
		if err := json.Unmarshal(data, &m); err != nil {
			return nil, fmt.Errorf("bridgeloop: %s: %w", l.catchUpFile(), err)
		}
		if m.Target > 0 {
			l.catchup = m.Target
			l.st.CatchUp = &CatchUp{Target: m.Target}
		}
	case !errors.Is(err, os.ErrNotExist):
		return nil, err
	}
	return l, nil
}

func (l *Loop) runDir() string      { return filepath.Join(l.o.DataDir, "run") }
func (l *Loop) pendingFile() string { return filepath.Join(l.runDir(), "pending.json") }
func (l *Loop) catchUpFile() string { return filepath.Join(l.runDir(), "catchup.json") }

// Notify asks for a sync now (wallet-rpc saw a transaction). It never blocks.
func (l *Loop) Notify() {
	select {
	case l.notify <- struct{}{}:
	default:
	}
}

// Soon reports whether the next sync should follow at once (reconcile, more watched indexes to cover, or new
// addresses to deliver).
func (l *Loop) Soon() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.soon
}

// Status returns a copy of the current status.
func (l *Loop) Status() Status {
	l.mu.Lock()
	defer l.mu.Unlock()
	st := l.st
	if st.CatchUp != nil {
		c := *st.CatchUp
		st.CatchUp = &c
	}
	return st
}

// Run syncs until ctx ends.
func (l *Loop) Run(ctx context.Context) error {
	var backoff time.Duration
	for {
		err := l.SyncOnce(ctx)
		if ctx.Err() != nil {
			return nil
		}
		var wait time.Duration
		notify := l.notify
		if err != nil {
			backoff = nextBackoff(backoff, l.o.BackoffMin, l.o.BackoffMax)
			wait = backoff
			notify = nil // while backing off, a notify doesn't hammer an unreachable site
			l.o.Log.Warn("sync failed", "err", err, "retry in", wait)
		} else {
			backoff = 0
			if !l.Soon() {
				wait = l.o.Interval + time.Duration(rand.Int64N(int64(l.o.Jitter)+1))
			}
		}
		t := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			t.Stop()
			return nil
		case <-t.C:
		case <-notify:
			t.Stop()
			select { // let a burst of notifications settle into one sync
			case <-ctx.Done():
				return nil
			case <-time.After(l.o.Debounce):
			}
			select {
			case <-l.notify:
			default:
			}
		}
	}
}

func nextBackoff(prev, min, max time.Duration) time.Duration {
	if prev == 0 {
		return min
	}
	if prev*2 > max {
		return max
	}
	return prev * 2
}

// SyncOnce makes one sync: snapshots for (the next chunk of) the watch list, any pending addresses, then a top-up
// if the site's pool is short. It records the outcome in the status file.
func (l *Loop) SyncOnce(ctx context.Context) error {
	err := l.syncOnce(ctx)
	l.mu.Lock()
	l.st.LastAttemptAt = l.o.Now()
	if err != nil {
		l.st.LastError = err.Error()
	} else {
		l.st.LastError = ""
		l.st.LastSyncAt = l.st.LastAttemptAt
	}
	l.st.Pending = len(l.pending)
	l.mu.Unlock()
	l.writeStatus()
	return err
}

// ErrNotPaired: no bridge key yet.
var ErrNotPaired = errors.New("this wallet host is not paired yet. Press " + sitetext.Button + " and run the command it shows")

func (l *Loop) syncOnce(ctx context.Context) error {
	key := l.o.Key
	if l.o.LoadKey != nil {
		k, err := l.o.LoadKey()
		if errors.Is(err, os.ErrNotExist) {
			return ErrNotPaired
		}
		if err != nil {
			return fmt.Errorf("bridge key: %w", err)
		}
		key = k
	}
	wctx, cancel := context.WithTimeout(ctx, walletTimeout)
	w, err := l.o.Wallet(wctx)
	cancel()
	if err != nil {
		return fmt.Errorf("wallet-rpc isn't ready: %w", err)
	}
	height, err := w.GetHeight(ctx)
	if err != nil {
		return fmt.Errorf("wallet: %w", err)
	}
	l.mu.Lock()
	target := l.catchup
	l.mu.Unlock()
	if target > 0 { // unfinished (a failed rescan, or a restart): redo it before any snapshot
		if err := l.catchUp(ctx, w, target); err != nil {
			return err
		}
	}

	l.mu.Lock()
	learning := l.watch == nil
	var chunk []uint32
	if !learning {
		if l.cursor >= len(l.watch) {
			l.cursor = 0
		}
		end := min(l.cursor+maxSnapshots, len(l.watch))
		chunk = append(chunk, l.watch[l.cursor:end]...)
	}
	addresses := append([]syncclient.Address(nil), l.pending[:min(len(l.pending), maxAddresses)]...)
	l.mu.Unlock()

	snapshots, warnings, err := l.snapshots(ctx, w, chunk)
	if err != nil {
		return err
	}
	var resp syncclient.Response
	sent := len(snapshots)
	l.mu.Lock()
	nc := l.st.NodeCheck
	l.mu.Unlock()
	checks := &syncclient.Checks{Node: &syncclient.Check{State: string(nc.State), Detail: nc.Detail}, Wallet: l.walletCheck(ctx, height)}
	for {
		body := syncclient.Body{V: syncclient.ProtocolV, Seq: l.nextSeq(), Height: height, Addresses: addresses, Snapshots: snapshots[:sent], Checks: checks}
		resp, err = l.o.Site.Send(ctx, key, body)
		if errors.Is(err, syncclient.ErrTooLarge) && sent > 1 {
			sent /= 2
			continue
		}
		l.mu.Lock()
		var se *syncclient.Error
		switch {
		case err == nil:
			l.st.Synced++
		case errors.As(err, &se):
			l.st.SiteRefused++
		case !errors.Is(err, syncclient.ErrTooLarge):
			l.st.Unreachable++
		}
		l.mu.Unlock()
		if err != nil {
			return err
		}
		break
	}

	l.mu.Lock()
	defer l.mu.Unlock()
	l.pending = l.pending[len(addresses):]
	if len(addresses) > 0 {
		l.savePending()
	}
	l.watch = resp.Watch
	passDone := true
	if !learning {
		l.cursor += sent
		passDone = l.cursor >= len(l.watch)
		if passDone {
			l.cursor = 0
		}
	}
	l.st.WalletHeight, l.st.PoolFree, l.st.PoolTarget, l.st.Watching, l.st.Warnings = height, resp.PoolFree, resp.PoolTarget, len(resp.Watch), warnings
	l.poolTop = resp.PoolTop

	// The site holds an index the wallet may lack (a reinstall from keys): catch up before anything is reported or
	// topped up. Probed only when the pool outgrows what the wallet is known to have.
	if top := resp.PoolTop; top > l.known {
		l.mu.Unlock()
		has, err := w.HasSubaddress(ctx, top)
		if err == nil && !has {
			err = l.catchUp(ctx, w, top)
		}
		l.mu.Lock()
		if err != nil {
			return fmt.Errorf("wallet: %w", err)
		}
		if !has {
			return nil // caught up; the next sync reconciles and tops up
		}
		l.known = top
	}

	// Top up: the site's free addresses plus those already on their way must reach the target.
	need := resp.PoolTarget - resp.PoolFree - len(l.pending)
	need = min(need, maxAddresses-len(l.pending))
	if need > 0 {
		l.mu.Unlock()
		created, cerr := l.create(ctx, w, need)
		l.mu.Lock()
		// An index the site already has means the wallet is behind after all: never send it (the duplicate loop of
		// 3h's L3), catch up on the next sync instead.
		behind := false
		for _, a := range created {
			if a.Index <= l.poolTop {
				behind = true
				continue
			}
			l.known = max(l.known, a.Index)
			l.pending = append(l.pending, a)
		}
		if len(created) > 0 {
			l.savePending()
		}
		if behind && l.catchup == 0 {
			l.o.Log.Warn("the wallet returned an address the site already has; catching it up", "poolTop", l.poolTop)
			l.catchup = l.poolTop
			l.st.CatchUp = &CatchUp{Target: l.poolTop}
			l.saveCatchUp()
		}
		if cerr != nil {
			l.o.Log.Warn("creating pool addresses", "err", cerr)
		}
	}
	l.soon = learning || !passDone || len(l.pending) > 0 || l.catchup > 0
	return nil
}

// catchUp brings a wallet restored from keys up to the site's pool (spec change 15): it creates subaddresses up to
// target without sending them (the site has them), then rescans once so payments mined to them before they existed
// in this wallet are found. The marker file makes an interrupted catch-up start again, rescan included.
func (l *Loop) catchUp(ctx context.Context, w Wallet, target uint32) error {
	l.mu.Lock()
	l.catchup = target
	l.st.CatchUp = &CatchUp{Target: target}
	err := l.saveCatchUp()
	l.mu.Unlock()
	l.writeStatus()
	if err != nil {
		return err
	}
	l.o.Log.Info("catching the wallet up to the site's addresses", "target", target)

	// One address first: its index says where the wallet stands. If that is already past the target, it is a new
	// address for the pool (a catch-up redone after its addresses were made), so nothing is wasted.
	first, err := w.CreateAddresses(ctx, addressLabel, 1)
	if err != nil {
		return fmt.Errorf("catching up the wallet: %w", err)
	}
	top := first[0].Index
	var extra []syncclient.Address
	if top > target {
		extra = append(extra, syncclient.Address{Index: top, Address: first[0].Address})
	}
	for top < target {
		l.progress(top, false)
		as, err := w.CreateAddresses(ctx, addressLabel, int(min(target-top, createBatch)))
		if err != nil {
			return fmt.Errorf("catching up the wallet: %w", err)
		}
		if as[0].Index != top+1 {
			return fmt.Errorf("catching up the wallet: wallet-rpc skipped from index %d to %d", top, as[0].Index)
		}
		top = as[len(as)-1].Index
	}
	l.progress(top, true)
	l.o.Log.Info("rescanning the wallet", "addresses", top)
	rctx, cancel := context.WithTimeout(ctx, rescanLimit)
	err = w.RescanBlockchain(rctx)
	cancel()
	if err != nil {
		return fmt.Errorf("rescanning the wallet: %w", err)
	}

	l.mu.Lock()
	l.catchup, l.st.CatchUp = 0, nil
	l.known = max(l.known, top)
	l.poolTop = max(l.poolTop, target)
	if len(extra) > 0 {
		l.pending = append(l.pending, extra...)
		l.savePending()
	}
	l.cursor, l.soon = 0, true
	if err := os.Remove(l.catchUpFile()); err != nil && !errors.Is(err, os.ErrNotExist) {
		l.o.Log.Error("removing the catch-up marker", "err", err)
	}
	l.mu.Unlock()
	l.writeStatus()
	l.o.Log.Info("the wallet is caught up", "addresses", top)
	return nil
}

func (l *Loop) progress(top uint32, rescanning bool) {
	l.mu.Lock()
	if l.st.CatchUp != nil {
		l.st.CatchUp.Addresses, l.st.CatchUp.Rescanning = top, rescanning
	}
	l.mu.Unlock()
	l.writeStatus()
}

// saveCatchUp records the catch-up's target. Called with l.mu held.
func (l *Loop) saveCatchUp() error {
	data, _ := json.Marshal(map[string]uint32{"target": l.catchup})
	if err := writeAtomic(l.catchUpFile(), data); err != nil {
		l.o.Log.Error("saving the catch-up marker", "err", err)
		return err
	}
	return nil
}

func (l *Loop) create(ctx context.Context, w Wallet, n int) ([]syncclient.Address, error) {
	var out []syncclient.Address
	for i := 0; i < n; i++ {
		a, err := w.CreateAddress(ctx, addressLabel)
		if err != nil {
			return out, err
		}
		if a.Index < 1 || a.Address == "" {
			return out, errors.New("wallet-rpc returned an unusable address")
		}
		out = append(out, syncclient.Address{Index: a.Index, Address: a.Address})
	}
	l.o.Log.Info("created pool addresses", "count", len(out))
	return out, nil
}

// snapshots reads the chunk's transfers in one call and builds one snapshot per index (empty when nothing
// arrived), each with at most 32 transfers: the largest, ties to the earlier height (spec change 12).
func (l *Loop) snapshots(ctx context.Context, w Wallet, chunk []uint32) ([]syncclient.Snapshot, []string, error) {
	if len(chunk) == 0 {
		return nil, nil, nil
	}
	all, err := w.GetTransfers(ctx, chunk)
	if err != nil {
		return nil, nil, fmt.Errorf("wallet: %w", err)
	}
	if l.o.CrossCheck != nil {
		var rep crosscheck.Report
		all, rep = l.o.CrossCheck.Check(ctx, all)
		l.mu.Lock()
		l.st.NodeCheck = rep
		l.mu.Unlock()
		if rep.State == crosscheck.Mismatch || rep.State == crosscheck.Unavailable {
			l.o.Log.Warn("node cross-check", "state", rep.State, "detail", rep.Detail)
		}
	}
	by := map[uint32][]walletrpc.Transfer{}
	seen := map[uint32]map[string]bool{}
	for _, t := range all {
		if seen[t.Index] == nil {
			seen[t.Index] = map[string]bool{}
		}
		if seen[t.Index][t.TxID] {
			continue // one entry per transaction and address; the plugin refuses duplicates
		}
		seen[t.Index][t.TxID] = true
		by[t.Index] = append(by[t.Index], t)
	}
	var warnings []string
	out := make([]syncclient.Snapshot, 0, len(chunk))
	for _, idx := range chunk {
		ts := by[idx]
		if len(ts) > maxTransfers {
			sort.SliceStable(ts, func(i, j int) bool {
				if ts[i].Amount != ts[j].Amount {
					return less(ts[j].Amount, ts[i].Amount)
				}
				return ts[i].Height < ts[j].Height
			})
			warnings = append(warnings, fmt.Sprintf("subaddress %d has %d incoming transfers; only the 32 largest are reported (spec change 12)", idx, len(ts)))
			ts = ts[:maxTransfers]
		}
		snap := syncclient.Snapshot{Index: idx, Transfers: make([]syncclient.Transfer, 0, len(ts))}
		for _, t := range ts {
			snap.Transfers = append(snap.Transfers, syncclient.Transfer{TxID: t.TxID, Amount: t.Amount, Confirmations: t.Confirmations,
				Height: t.Height, Timestamp: t.Timestamp, DoubleSpendSeen: t.DoubleSpendSeen, UnlockTime: t.UnlockTime})
		}
		out = append(out, snap)
	}
	for _, w := range warnings {
		l.o.Log.Warn(w)
	}
	return out, warnings, nil
}

// less compares decimal strings without leading zeros (amounts from strconv.FormatUint).
func less(a, b string) bool {
	if len(a) != len(b) {
		return len(a) < len(b)
	}
	return a < b
}

// walletCheck compares the wallet's height with its node's (asked at most every nodeHeightEvery); nil without
// NodeHeight. The node's error stays in the log: it can hold the node's address, which the site doesn't need.
func (l *Loop) walletCheck(ctx context.Context, wallet uint64) *syncclient.Check {
	if l.o.NodeHeight == nil {
		return nil
	}
	now := l.o.Now()
	l.mu.Lock()
	stale := l.nodeAt.IsZero() || now.Sub(l.nodeAt) >= nodeHeightEvery
	l.mu.Unlock()
	if stale {
		h, err := l.o.NodeHeight(ctx)
		if err != nil {
			l.o.Log.Warn("reading the node's height", "err", err)
		}
		l.mu.Lock()
		l.nodeAt, l.nodeHeight, l.nodeErr = now, h, err
		l.mu.Unlock()
	}
	l.mu.Lock()
	node, err := l.nodeHeight, l.nodeErr
	l.mu.Unlock()
	if err != nil {
		return &syncclient.Check{State: "unavailable", Detail: "the wallet host's node didn't answer; on the wallet host, run xmr-bridge status"}
	}
	detail := fmt.Sprintf("the wallet is at block %d, its node at %d", wallet, node)
	if node > wallet+walletBehind {
		return &syncclient.Check{State: "behind", Detail: detail}
	}
	return &syncclient.Check{State: "ok", Detail: detail}
}

func (l *Loop) nextSeq() int64 {
	l.mu.Lock()
	defer l.mu.Unlock()
	s := l.o.Now().UnixMilli()
	if s <= l.lastSeq {
		s = l.lastSeq + 1
	}
	l.lastSeq = s
	return s
}

// savePending writes the pending addresses (or removes the file when none). Called with l.mu held.
func (l *Loop) savePending() {
	if len(l.pending) == 0 {
		os.Remove(l.pendingFile())
		return
	}
	data, _ := json.Marshal(l.pending)
	if err := writeAtomic(l.pendingFile(), data); err != nil {
		l.o.Log.Error("saving pending addresses", "err", err)
	}
}

func (l *Loop) writeStatus() {
	st := l.Status()
	if l.o.Extra != nil {
		st.WalletRPC = l.o.Extra()
	}
	if l.o.Updates != nil {
		st.Updates = l.o.Updates()
	}
	data, _ := json.MarshalIndent(st, "", "  ")
	if err := writeAtomic(filepath.Join(l.runDir(), "status.json"), append(data, '\n')); err != nil {
		l.o.Log.Error("writing status", "err", err)
	}
}

// ReadStatus reads the status file the running bridge writes.
func ReadStatus(dataDir string) (Status, error) {
	var st Status
	data, err := os.ReadFile(filepath.Join(dataDir, "run", "status.json"))
	if err != nil {
		return st, err
	}
	return st, json.Unmarshal(data, &st)
}

func writeAtomic(path string, data []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".tmp-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	defer tmp.Close()
	if err := tmp.Chmod(0o600); err != nil {
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}
