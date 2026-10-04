package supervise

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/config"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/walletrpc"
)

type harness struct {
	s      *Supervisor
	record string
	data   string
	cancel context.CancelFunc
	done   chan error
	once   sync.Once
}

// start runs a supervisor whose child is this test binary acting as a fake wallet-rpc in the given mode.
func start(t *testing.T, mode string, tweak func(*Options)) *harness {
	t.Helper()
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	h := &harness{data: t.TempDir(), done: make(chan error, 1)}
	h.record = filepath.Join(h.data, "record.jsonl")
	opts := Options{
		Binary:        self,
		DataDir:       h.data,
		Network:       config.Stagenet,
		Node:          "http://127.0.0.1:38081",
		NotifyCommand: []string{"/usr/local/bin/xmr-bridge", "notify", "--pid", "4242"},
		Env:           []string{"XMR_FAKE_WALLET_RPC=1", "XMR_FAKE_MODE=" + mode, "XMR_FAKE_RECORD=" + h.record},
		ReadyTimeout:  5 * time.Second,
		StopTimeout:   2 * time.Second,
		BackoffMin:    20 * time.Millisecond,
		BackoffMax:    80 * time.Millisecond,
		StableAfter:   time.Hour,
	}
	if tweak != nil {
		tweak(&opts)
	}
	s, err := New(opts)
	if err != nil {
		t.Fatal(err)
	}
	h.s = s
	ctx, cancel := context.WithCancel(context.Background())
	h.cancel = cancel
	go func() { h.done <- s.Run(ctx) }()
	t.Cleanup(func() { h.stop(t) })
	return h
}

// stop cancels the supervisor and waits for Run to return (once; cleanup calls it again).
func (h *harness) stop(t *testing.T) {
	h.once.Do(func() {
		h.cancel()
		select {
		case <-h.done:
		case <-time.After(10 * time.Second):
			t.Fatal("Run did not return after cancel")
		}
	})
}

func (h *harness) records(t *testing.T) []fakeRecord {
	t.Helper()
	data, _ := os.ReadFile(h.record)
	var out []fakeRecord
	for _, line := range strings.Split(strings.TrimSpace(string(data)), "\n") {
		if line == "" {
			continue
		}
		var r fakeRecord
		if err := json.Unmarshal([]byte(line), &r); err != nil {
			t.Fatal(err)
		}
		out = append(out, r)
	}
	return out
}

func alive(pid int) bool { return pid > 0 && syscall.Kill(pid, 0) == nil }

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestStartsAndBecomesReady(t *testing.T) {
	h := start(t, "", nil)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	c, err := h.s.WaitReady(ctx)
	if err != nil {
		t.Fatal(err)
	}
	v, err := c.GetVersion(ctx)
	if err != nil || v.Version != 65562 {
		t.Fatalf("GetVersion through the supervisor's client: %+v %v", v, err)
	}
	recs := h.records(t)
	if len(recs) != 1 {
		t.Fatalf("%d starts", len(recs))
	}
	r := recs[0]
	args := strings.Join(r.Args, " ")
	for _, want := range []string{"--config-file " + filepath.Join(h.data, "run", "wallet-rpc.conf"), "--rpc-bind-ip 127.0.0.1",
		"--non-interactive", "--stagenet", "--daemon-address 127.0.0.1:38081", "--daemon-ssl disabled",
		"--wallet-dir " + filepath.Join(h.data, "wallet"), "--shared-ringdb-dir " + filepath.Join(h.data, "ringdb"),
		"--log-file " + filepath.Join(h.data, "log", "wallet-rpc.log"), "--max-log-files 2",
		"--tx-notify /usr/local/bin/xmr-bridge notify --pid 4242 %s"} {
		if !strings.Contains(args, want) {
			t.Errorf("args lack %q:\n%s", want, args)
		}
	}
	if r.PassInArgs || r.User == "" || r.PassMD5 == "" || r.ConfMode != "-rw-------" || r.ConfLines != 1 {
		t.Fatalf("login handling: %+v", r)
	}
	for _, e := range r.Env {
		if strings.HasPrefix(e, "HOME=") || strings.HasPrefix(e, "PATH=") {
			t.Errorf("child inherited %s", e)
		}
	}
	waitFor(t, "the config file to be removed", func() bool {
		_, err := os.Stat(filepath.Join(h.data, "run", "wallet-rpc.conf"))
		return errors.Is(err, os.ErrNotExist)
	})
	st := h.s.Status()
	if !st.Running || !st.Ready || st.PID != r.PID || st.Restarts != 0 {
		t.Fatalf("status %+v", st)
	}
}

func TestRestartsAfterCrashWithNewLogin(t *testing.T) {
	h := start(t, "crash-after-ready", nil)
	waitFor(t, "three starts", func() bool { return len(h.records(t)) >= 3 && h.s.Status().Restarts >= 2 })
	st := h.s.Status()
	if !strings.Contains(st.LastExit, "exit status 7") || !strings.Contains(st.LastExit, "crashing on purpose") {
		t.Fatalf("last exit %q", st.LastExit)
	}
	recs := h.records(t)
	if len(recs) < 3 {
		t.Fatalf("%d starts", len(recs))
	}
	if recs[0].PassMD5 == recs[1].PassMD5 || recs[1].PassMD5 == recs[2].PassMD5 {
		t.Fatal("the login was reused across starts")
	}
}

func TestStopLeavesNoChild(t *testing.T) {
	h := start(t, "", nil)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := h.s.WaitReady(ctx); err != nil {
		t.Fatal(err)
	}
	pid := h.s.Status().PID
	h.stop(t)
	if alive(pid) {
		t.Fatalf("child %d still running after stop", pid)
	}
	if st := h.s.Status(); st.Running || st.Ready {
		t.Fatalf("status after stop %+v", st)
	}
}

func TestStopKillsAChildThatIgnoresTerm(t *testing.T) {
	h := start(t, "ignore-term", func(o *Options) { o.StopTimeout = 200 * time.Millisecond })
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := h.s.WaitReady(ctx); err != nil {
		t.Fatal(err)
	}
	pid := h.s.Status().PID
	begin := time.Now()
	h.stop(t)
	if alive(pid) {
		t.Fatalf("child %d survived", pid)
	}
	if d := time.Since(begin); d < 200*time.Millisecond || d > 5*time.Second {
		t.Fatalf("stop took %v", d)
	}
}

func TestNeverReadyIsRestarted(t *testing.T) {
	h := start(t, "never-ready", func(o *Options) { o.ReadyTimeout = 300 * time.Millisecond })
	waitFor(t, "a restart", func() bool { return h.s.Status().Restarts >= 1 })
	if st := h.s.Status(); !strings.Contains(st.LastExit, "not ready") {
		t.Fatalf("last exit %q", st.LastExit)
	}
	recs := h.records(t)
	if len(recs) >= 2 && alive(recs[0].PID) {
		t.Fatalf("the unready child %d was left running", recs[0].PID)
	}
}

func TestWaitReadyHonorsContext(t *testing.T) {
	h := start(t, "exit-at-once", nil)
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	if _, err := h.s.WaitReady(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("got %v", err)
	}
}

func TestBackoff(t *testing.T) {
	min, max, stable := 1*time.Second, 60*time.Second, 5*time.Minute
	cases := []struct {
		prev, ran, want time.Duration
	}{
		{0, 0, min},
		{min, 0, 2 * min},
		{32 * time.Second, time.Second, max},
		{max, time.Second, max},
		{max, stable, min}, // it ran long enough: start over
	}
	for _, c := range cases {
		if got := nextBackoff(c.prev, c.ran, min, max, stable); got != c.want {
			t.Errorf("nextBackoff(%v, %v) = %v, want %v", c.prev, c.ran, got, c.want)
		}
	}
}

func TestNewRefuses(t *testing.T) {
	base := Options{Binary: "/bin/true", DataDir: "/tmp/x", Network: config.Stagenet, Node: "http://127.0.0.1:38081"}
	for name, f := range map[string]func(*Options){
		"relative binary":         func(o *Options) { o.Binary = "monero-wallet-rpc" },
		"relative data dir":       func(o *Options) { o.DataDir = "data" },
		"bad node":                func(o *Options) { o.Node = "127.0.0.1:38081" },
		"space in notify command": func(o *Options) { o.NotifyCommand = []string{"/opt/my bridge/xmr-bridge", "notify"} },
		"percent in notify":       func(o *Options) { o.NotifyCommand = []string{"/usr/local/bin/xmr-bridge", "%s"} },
		"unknown network":         func(o *Options) { o.Network = "regtest" },
	} {
		o := base
		f(&o)
		if _, err := New(o); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

// With no Env, the child gets an empty environment, not the bridge's (exec inherits when Env is nil).
func TestDefaultEnvironmentIsEmpty(t *testing.T) {
	s, err := New(Options{Binary: "/bin/true", DataDir: "/tmp/x", Network: config.Stagenet, Node: "http://127.0.0.1:38081"})
	if err != nil {
		t.Fatal(err)
	}
	if s.o.Env == nil || len(s.o.Env) != 0 {
		t.Fatalf("env %v", s.o.Env)
	}
}

// If the bridge is killed outright (no chance to stop its child), wallet-rpc goes with it (parent-death signal).
func TestChildDiesWithTheBridge(t *testing.T) {
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	pidfile := filepath.Join(dir, "child.pid")
	bridge := exec.Command(self)
	bridge.Env = []string{"XMR_FAKE_BRIDGE=1", "XMR_FAKE_DATA=" + dir, "XMR_FAKE_PIDFILE=" + pidfile}
	if err := bridge.Start(); err != nil {
		t.Fatal(err)
	}
	defer bridge.Process.Kill()
	var child int
	waitFor(t, "the fake bridge's child", func() bool {
		b, err := os.ReadFile(pidfile)
		if err != nil || len(b) == 0 {
			return false
		}
		child, err = strconv.Atoi(string(b))
		return err == nil && alive(child)
	})
	bridge.Process.Signal(syscall.SIGKILL)
	bridge.Wait()
	waitFor(t, "the child to exit after the bridge was killed", func() bool { return !alive(child) || zombieOrGone(child) })
}

// zombieOrGone: an exited child of a killed parent is reparented and reaped, but may briefly show as a zombie.
func zombieOrGone(pid int) bool {
	b, err := os.ReadFile(filepath.Join("/proc", strconv.Itoa(pid), "stat"))
	if err != nil {
		return true
	}
	f := strings.Fields(string(b))
	return len(f) > 2 && f[2] == "Z"
}

// Init runs on every start with a working client, before the supervisor reports ready; if it fails, that start
// counts as failed (child stopped, backoff, restart).
func TestInitRunsEachStart(t *testing.T) {
	var calls atomic.Int32
	h := start(t, "", func(o *Options) {
		o.Init = func(ctx context.Context, c *walletrpc.Client) error {
			if _, err := c.GetVersion(ctx); err != nil {
				return err
			}
			if calls.Add(1) == 1 {
				return errors.New("wallet would not open")
			}
			return nil
		}
	})
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := h.s.WaitReady(ctx); err != nil {
		t.Fatal(err)
	}
	st := h.s.Status()
	if calls.Load() != 2 || st.Restarts != 1 || !strings.Contains(st.LastExit, "wallet would not open") {
		t.Fatalf("calls %d, status %+v", calls.Load(), st)
	}
	recs := h.records(t)
	if len(recs) != 2 || alive(recs[0].PID) {
		t.Fatalf("the first child should have been stopped: %d starts", len(recs))
	}
}
