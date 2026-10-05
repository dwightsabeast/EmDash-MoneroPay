package bridgeloop

import (
	"context"
	"crypto/ed25519"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/crosscheck"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/syncclient"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/syncsign"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/walletrpc"
)

// fakeWallet stands in for wallet-rpc: transfers by index, addresses created in order from next.
type fakeWallet struct {
	mu        sync.Mutex
	height    uint64
	transfers map[uint32][]walletrpc.Transfer
	next      uint32
	created   int
	asked     [][]uint32
}

func (w *fakeWallet) GetHeight(context.Context) (uint64, error) { return w.height, nil }
func (w *fakeWallet) GetTransfers(_ context.Context, idx []uint32) ([]walletrpc.Transfer, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.asked = append(w.asked, append([]uint32(nil), idx...))
	var out []walletrpc.Transfer
	for _, i := range idx {
		for _, t := range w.transfers[i] {
			t.Index = i // as wallet-rpc reports subaddr_index
			out = append(out, t)
		}
	}
	return out, nil
}
func (w *fakeWallet) CreateAddress(context.Context, string) (walletrpc.NewAddress, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.next++
	w.created++
	return walletrpc.NewAddress{Index: w.next, Address: "5" + strings.Repeat(strconv.Itoa(int(w.next%10)), 94)}, nil
}

// fakeSite answers like the plugin: it keeps a pool and a watch list, and records every body.
type fakeSite struct {
	mu     sync.Mutex
	pool   map[uint32]bool
	target int
	watch  []uint32
	bodies []syncclient.Body
	fail   error
	limit  int // refuse bodies with more snapshots than this (as ErrTooLarge)
}

func (s *fakeSite) Send(_ context.Context, _ ed25519.PrivateKey, b syncclient.Body) (syncclient.Response, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.limit > 0 && len(b.Snapshots) > s.limit {
		return syncclient.Response{}, syncclient.ErrTooLarge
	}
	s.bodies = append(s.bodies, b)
	if s.fail != nil {
		return syncclient.Response{}, s.fail
	}
	for _, a := range b.Addresses {
		s.pool[a.Index] = true
	}
	return syncclient.Response{PoolFree: len(s.pool), PoolTarget: s.target, Watch: append([]uint32(nil), s.watch...)}, nil
}

func (s *fakeSite) last() syncclient.Body {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.bodies[len(s.bodies)-1]
}

func setup(t *testing.T) (*Loop, *fakeWallet, *fakeSite, string) {
	t.Helper()
	w := &fakeWallet{height: 2222000, transfers: map[uint32][]walletrpc.Transfer{}}
	s := &fakeSite{pool: map[uint32]bool{}, target: 50}
	dir := t.TempDir()
	k, _ := syncsign.NewKey()
	clock := time.Unix(1790000000, 0)
	l, err := New(Options{
		Wallet:  func(context.Context) (Wallet, error) { return w, nil },
		Site:    s,
		Key:     k,
		DataDir: dir,
		Now:     func() time.Time { return clock },
	})
	if err != nil {
		t.Fatal(err)
	}
	return l, w, s, dir
}

func tr(txid byte, amount string, height uint64) walletrpc.Transfer {
	return walletrpc.Transfer{TxID: strings.Repeat(string(txid), 64), Amount: amount, Height: height, UnlockTime: "0", Confirmations: 1}
}

func TestReconcileOnStart(t *testing.T) {
	l, w, s, _ := setup(t)
	s.watch = []uint32{12, 17}
	s.target = 0
	w.transfers[12] = []walletrpc.Transfer{tr('a', "1000", 2221990)}
	if err := l.SyncOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if b := s.last(); len(b.Snapshots) != 0 || b.V != 1 || b.Height != 2222000 {
		t.Fatalf("first sync after start: %+v", b)
	}
	if !l.Soon() {
		t.Fatal("the reconcile sync should follow at once")
	}
	if err := l.SyncOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	b := s.last()
	if len(b.Snapshots) != 2 || b.Snapshots[0].Index != 12 || len(b.Snapshots[0].Transfers) != 1 || b.Snapshots[1].Index != 17 || len(b.Snapshots[1].Transfers) != 0 {
		t.Fatalf("reconcile: %+v", b.Snapshots)
	}
	got := b.Snapshots[0].Transfers[0]
	if got.Amount != "1000" || got.UnlockTime != "0" || got.Height != 2221990 || got.TxID != strings.Repeat("a", 64) {
		t.Fatalf("transfer %+v", got)
	}
	if l.Soon() {
		t.Fatal("nothing left to do, but another immediate sync is planned")
	}
}

func TestPoolTopUp(t *testing.T) {
	l, w, s, dir := setup(t)
	ctx := context.Background()
	l.SyncOnce(ctx) // free 0 of 50: creates 50
	if w.created != 50 {
		t.Fatalf("created %d", w.created)
	}
	if _, err := os.Stat(filepath.Join(dir, "run", "pending.json")); err != nil {
		t.Fatalf("pending addresses not saved: %v", err)
	}
	l.SyncOnce(ctx)
	if b := s.last(); len(b.Addresses) != 50 || b.Addresses[0].Index != 1 {
		t.Fatalf("addresses sent: %d", len(b.Addresses))
	}
	if len(s.pool) != 50 {
		t.Fatalf("pool %d", len(s.pool))
	}
	if _, err := os.Stat(filepath.Join(dir, "run", "pending.json")); !os.IsNotExist(err) {
		t.Fatal("pending file kept after the site took them")
	}
	l.SyncOnce(ctx)
	if w.created != 50 || len(s.last().Addresses) != 0 {
		t.Fatalf("pool full, yet created %d / sent %d", w.created, len(s.last().Addresses))
	}
}

func TestPendingSurvivesFailureAndRestart(t *testing.T) {
	l, w, s, dir := setup(t)
	ctx := context.Background()
	l.SyncOnce(ctx) // creates 50 pending
	s.fail = errors.New("site down")
	if err := l.SyncOnce(ctx); err == nil {
		t.Fatal("no error")
	}
	if w.created != 50 {
		t.Fatalf("created more while the site was down: %d", w.created)
	}
	// A new loop (a restart) picks the pending addresses up from disk.
	k, _ := syncsign.NewKey()
	l2, err := New(Options{Wallet: func(context.Context) (Wallet, error) { return w, nil }, Site: s, Key: k, DataDir: dir})
	if err != nil {
		t.Fatal(err)
	}
	s.fail = nil
	l2.SyncOnce(ctx)
	if b := s.last(); len(b.Addresses) != 50 {
		t.Fatalf("after restart sent %d", len(b.Addresses))
	}
	if w.created != 50 {
		t.Fatalf("created %d", w.created)
	}
	fi, _ := os.Stat(filepath.Join(dir, "run"))
	if fi.Mode().Perm() != 0o700 {
		t.Fatalf("run dir mode %v", fi.Mode().Perm())
	}
}

func TestAtMost100AddressesPerSync(t *testing.T) {
	l, w, s, _ := setup(t)
	s.target = 250
	ctx := context.Background()
	for i := 0; i < 6; i++ {
		l.SyncOnce(ctx)
	}
	for _, b := range s.bodies {
		if len(b.Addresses) > 100 {
			t.Fatalf("%d addresses in one sync", len(b.Addresses))
		}
	}
	if len(s.pool) != 250 || w.created != 250 {
		t.Fatalf("pool %d created %d", len(s.pool), w.created)
	}
}

func TestLargestThirtyTwo(t *testing.T) {
	l, w, s, _ := setup(t)
	s.target, s.watch = 0, []uint32{5}
	for i := 0; i < 40; i++ {
		w.transfers[5] = append(w.transfers[5], walletrpc.Transfer{TxID: fmt.Sprintf("%064x", i), Amount: strconv.Itoa(1000 + i), Height: uint64(100 + i), UnlockTime: "0"})
	}
	// two equal amounts at the edge: the earlier height wins
	w.transfers[5] = append(w.transfers[5], walletrpc.Transfer{TxID: fmt.Sprintf("%064x", 999), Amount: "1008", Height: 50, UnlockTime: "0"})
	ctx := context.Background()
	l.SyncOnce(ctx)
	l.SyncOnce(ctx)
	snap := s.last().Snapshots[0]
	if len(snap.Transfers) != 32 {
		t.Fatalf("%d transfers", len(snap.Transfers))
	}
	var amounts []int
	for _, x := range snap.Transfers {
		a, _ := strconv.Atoi(x.Amount)
		amounts = append(amounts, a)
	}
	sort.Ints(amounts)
	if amounts[0] != 1008 || amounts[31] != 1039 {
		t.Fatalf("kept %v", amounts)
	}
	kept999 := false
	for _, x := range snap.Transfers {
		kept999 = kept999 || x.TxID == fmt.Sprintf("%064x", 999)
	}
	if !kept999 {
		t.Fatal("the tie at the edge should keep the earlier height")
	}
	if st := l.Status(); len(st.Warnings) == 0 || !strings.Contains(st.Warnings[0], "32") {
		t.Fatalf("no warning: %+v", st)
	}
}

func TestAmountsCompareAsNumbers(t *testing.T) {
	if !less("999", "1000") || less("1000", "999") || less("5", "5") || !less("18446744073709551614", "18446744073709551615") {
		t.Fatal("decimal comparison")
	}
}

func TestDuplicateTxidsCollapsed(t *testing.T) {
	l, w, s, _ := setup(t)
	s.target, s.watch = 0, []uint32{5}
	w.transfers[5] = []walletrpc.Transfer{tr('a', "10", 1), tr('a', "10", 1), tr('b', "20", 2)}
	ctx := context.Background()
	l.SyncOnce(ctx)
	l.SyncOnce(ctx)
	if n := len(s.last().Snapshots[0].Transfers); n != 2 {
		t.Fatalf("%d transfers", n)
	}
}

func TestRotationCoversEveryIndex(t *testing.T) {
	l, w, s, _ := setup(t)
	s.target = 0
	for i := uint32(1); i <= 250; i++ {
		s.watch = append(s.watch, i)
	}
	ctx := context.Background()
	l.SyncOnce(ctx) // learns the watch list
	seen := map[uint32]bool{}
	for i := 0; i < 3; i++ {
		l.SyncOnce(ctx)
		b := s.last()
		if len(b.Snapshots) > 100 {
			t.Fatalf("%d snapshots", len(b.Snapshots))
		}
		for _, sn := range b.Snapshots {
			seen[sn.Index] = true
		}
		if i < 2 && !l.Soon() {
			t.Fatal("more indexes to cover: the next sync should follow at once")
		}
	}
	if len(seen) != 250 {
		t.Fatalf("covered %d of 250", len(seen))
	}
	if len(w.asked) != 3 {
		t.Fatalf("get_transfers calls %d", len(w.asked))
	}
}

func TestTooLargeSendsFewerSnapshots(t *testing.T) {
	l, _, s, _ := setup(t)
	s.target = 0
	for i := uint32(1); i <= 80; i++ {
		s.watch = append(s.watch, i)
	}
	s.limit = 30
	ctx := context.Background()
	l.SyncOnce(ctx)
	if err := l.SyncOnce(ctx); err != nil {
		t.Fatal(err)
	}
	if n := len(s.last().Snapshots); n == 0 || n > 30 {
		t.Fatalf("%d snapshots", n)
	}
}

func TestSeqAlwaysRises(t *testing.T) {
	l, _, s, _ := setup(t)
	clock := time.Unix(1790000000, 0)
	l.o.Now = func() time.Time { return clock }
	ctx := context.Background()
	l.SyncOnce(ctx)
	clock = clock.Add(-time.Hour) // the clock steps back
	l.SyncOnce(ctx)
	l.SyncOnce(ctx)
	for i := 1; i < len(s.bodies); i++ {
		if s.bodies[i].Seq <= s.bodies[i-1].Seq {
			t.Fatalf("seq %d after %d", s.bodies[i].Seq, s.bodies[i-1].Seq)
		}
	}
}

func TestErrorsAreRecorded(t *testing.T) {
	l, _, s, _ := setup(t)
	s.fail = &syncclient.Error{Code: "NOT_PAIRED", Hint: "pair again"}
	err := l.SyncOnce(context.Background())
	st := l.Status()
	if err == nil || !strings.Contains(st.LastError, "NOT_PAIRED") || !strings.Contains(st.LastError, "pair again") || !st.LastSyncAt.IsZero() {
		t.Fatalf("status %+v", st)
	}
	s.fail = nil
	l.SyncOnce(context.Background())
	if st := l.Status(); st.LastError != "" || st.LastSyncAt.IsZero() || st.PoolTarget != 50 {
		t.Fatalf("status after recovery %+v", st)
	}
}

func TestStatusFile(t *testing.T) {
	l, _, _, dir := setup(t)
	l.SyncOnce(context.Background())
	fi, err := os.Stat(filepath.Join(dir, "run", "status.json"))
	if err != nil || fi.Mode().Perm() != 0o600 {
		t.Fatalf("status file: %v %v", fi, err)
	}
	st, err := ReadStatus(dir)
	if err != nil || st.WalletHeight != 2222000 || st.PoolFree != 0 {
		t.Fatalf("read back %+v %v", st, err)
	}
}

func TestBackoff(t *testing.T) {
	for _, c := range []struct{ prev, want time.Duration }{{0, 15 * time.Second}, {15 * time.Second, 30 * time.Second}, {4 * time.Minute, 5 * time.Minute}, {5 * time.Minute, 5 * time.Minute}} {
		if got := nextBackoff(c.prev, 15*time.Second, 5*time.Minute); got != c.want {
			t.Errorf("after %v: %v, want %v", c.prev, got, c.want)
		}
	}
}

func TestNotifyTriggersASync(t *testing.T) {
	l, _, s, _ := setup(t)
	s.target = 0
	l.o.Interval, l.o.Jitter = time.Hour, 0
	l.o.Debounce = 10 * time.Millisecond
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { l.Run(ctx); close(done) }()
	waitFor(t, func() bool { s.mu.Lock(); defer s.mu.Unlock(); return len(s.bodies) >= 1 })
	time.Sleep(50 * time.Millisecond)
	s.mu.Lock()
	before := len(s.bodies)
	s.mu.Unlock()
	l.Notify()
	waitFor(t, func() bool { s.mu.Lock(); defer s.mu.Unlock(); return len(s.bodies) > before })
	cancel()
	<-done
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	for deadline := time.Now().Add(5 * time.Second); !cond(); time.Sleep(5 * time.Millisecond) {
		if time.Now().After(deadline) {
			t.Fatal("timed out")
		}
	}
}

// The key is read for every sync, so pairing again takes effect without a restart; no key means "not paired".
func TestKeyReadEachSync(t *testing.T) {
	l, _, s, _ := setup(t)
	var k ed25519.PrivateKey
	keyErr := error(os.ErrNotExist)
	l.o.LoadKey = func() (ed25519.PrivateKey, error) { return k, keyErr }
	err := l.SyncOnce(context.Background())
	if err == nil || !strings.Contains(err.Error(), "not paired") || len(s.bodies) != 0 {
		t.Fatalf("without a key: %v (%d sent)", err, len(s.bodies))
	}
	k, keyErr = func() (ed25519.PrivateKey, error) { return syncsign.NewKey() }()
	if err := l.SyncOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
}

// fakeCheck stands in for the cross-check: it zeroes every mined transfer's confirmations and reports a mismatch.
type fakeCheck struct{ calls int }

func (f *fakeCheck) Check(_ context.Context, ts []walletrpc.Transfer) ([]walletrpc.Transfer, crosscheck.Report) {
	f.calls++
	out := append([]walletrpc.Transfer{}, ts...)
	for i := range out {
		if out[i].Height > 0 {
			out[i].Confirmations = 0
		}
	}
	return out, crosscheck.Report{State: crosscheck.Mismatch, Detail: "block 100 differs", Node: "second.example:38089"}
}

func TestCrossCheckApplied(t *testing.T) {
	l, w, s, _ := setup(t)
	fc := &fakeCheck{}
	l.o.CrossCheck = fc
	s.target, s.watch = 0, []uint32{5}
	w.transfers[5] = []walletrpc.Transfer{tr('a', "1000", 100)}
	ctx := context.Background()
	l.SyncOnce(ctx)
	l.SyncOnce(ctx)
	b := s.last()
	if b.Snapshots[0].Transfers[0].Confirmations != 0 {
		t.Fatal("the cross-check's confirmations weren't used")
	}
	if b.Checks == nil || b.Checks.Node == nil || b.Checks.Node.State != "mismatch" || !strings.Contains(b.Checks.Node.Detail, "block 100") {
		t.Fatalf("checks sent: %+v", b.Checks)
	}
	if st := l.Status(); st.NodeCheck.State != crosscheck.Mismatch {
		t.Fatalf("status %+v", st.NodeCheck)
	}
}

func TestNoCrossCheckIsOff(t *testing.T) {
	l, _, s, _ := setup(t)
	l.SyncOnce(context.Background())
	if b := s.last(); b.Checks == nil || b.Checks.Node == nil || b.Checks.Node.State != "off" {
		t.Fatalf("checks %+v", b.Checks)
	}
	if st := l.Status(); st.NodeCheck.State != crosscheck.Off {
		t.Fatalf("status %+v", st.NodeCheck)
	}
}

// The loop counts what the site did with each sync it sent: accepted, refused (answered with an error), or never
// reached. Wallet errors before sending count as none of these (the 10-minute update rule depends on it).
func TestSiteAnswerCounts(t *testing.T) {
	l, _, s, _ := setup(t)
	ctx := context.Background()
	l.SyncOnce(ctx)
	s.fail = &syncclient.Error{Code: "BAD_SIGNATURE"}
	l.SyncOnce(ctx)
	s.fail = errors.New("syncclient: the site can't be reached: connection refused")
	l.SyncOnce(ctx)
	l.SyncOnce(ctx)
	l.o.Wallet = func(context.Context) (Wallet, error) { return nil, errors.New("wallet-rpc not ready") }
	l.SyncOnce(ctx)
	st := l.Status()
	if st.Synced != 1 || st.SiteRefused != 1 || st.Unreachable != 2 {
		t.Fatalf("counts synced %d refused %d unreachable %d", st.Synced, st.SiteRefused, st.Unreachable)
	}
}
