package main

import (
	"bytes"
	"context"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/config"
)

func run(ctx context.Context, args ...string) (int, string, string) {
	var out, errb bytes.Buffer
	code := realMain(ctx, args, &out, &errb)
	return code, out.String(), errb.String()
}

func TestVersion(t *testing.T) {
	code, out, _ := run(context.Background(), "version")
	if code != 0 || !strings.HasPrefix(out, "xmr-bridge ") || !strings.Contains(out, "go1.") {
		t.Fatalf("version: %d %q", code, out)
	}
}

func TestUsage(t *testing.T) {
	for _, args := range [][]string{nil, {"nope"}, {"run", "--bogus"}} {
		code, _, errOut := run(context.Background(), args...)
		if code != 2 || !strings.Contains(errOut, "usage") {
			t.Fatalf("%v: %d %q", args, code, errOut)
		}
	}
}

func TestRunStopsOnCancel(t *testing.T) {
	p := filepath.Join(t.TempDir(), "config")
	if err := config.Save(p, config.Config{Site: "http://localhost:4321", Network: config.Stagenet, Node: "http://127.0.0.1:38081", DataDir: "/tmp/x", AllowSameMachine: true}); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	var code int
	var errOut string
	go func() {
		code, _, errOut = run(ctx, "run", "--config", p)
		close(done)
	}()
	time.Sleep(50 * time.Millisecond)
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("run didn't stop on cancel")
	}
	if code != 0 || !strings.Contains(errOut, "msg=starting") || !strings.Contains(errOut, "network=stagenet") || !strings.Contains(errOut, "msg=stopped") {
		t.Fatalf("run: %d %q", code, errOut)
	}
}

func TestRunBadConfig(t *testing.T) {
	p := filepath.Join(t.TempDir(), "config")
	os.WriteFile(p, []byte(`{"site":"x"}`), 0o600)
	code, _, errOut := run(context.Background(), "run", "--config", p)
	if code != 1 || !strings.Contains(errOut, "config") {
		t.Fatalf("bad config: %d %q", code, errOut)
	}
	code, _, errOut = run(context.Background(), "run")
	if code != 2 || !strings.Contains(errOut, "--config") {
		t.Fatalf("missing --config: %d %q", code, errOut)
	}
}

// notify (run by wallet-rpc's --tx-notify) sends SIGUSR1 to the bridge, which syncs at once (3d).
func TestNotifySignalsTheBridge(t *testing.T) {
	got := make(chan os.Signal, 1)
	signal.Notify(got, syscall.SIGUSR1)
	defer signal.Stop(got)
	code, _, errOut := run(context.Background(), "notify", "--pid", strconv.Itoa(os.Getpid()), strings.Repeat("ab", 32))
	if code != 0 {
		t.Fatalf("notify: %d %q", code, errOut)
	}
	select {
	case <-got:
	case <-time.After(2 * time.Second):
		t.Fatal("no SIGUSR1")
	}
}

func TestNotifyRefuses(t *testing.T) {
	for _, args := range [][]string{
		{"notify"},
		{"notify", "--pid", "0"},
		{"notify", "--pid", "1"},
		{"notify", "--pid", "-5"},
		{"notify", "--pid", "x"},
		{"notify", "--pid", "123", "not-a-txid"},
		{"notify", "--pid", "123", strings.Repeat("ab", 32), "extra"},
	} {
		if code, _, _ := run(context.Background(), args...); code == 0 {
			t.Errorf("%v: accepted", args)
		}
	}
}

// run takes SIGUSR1 (from notify) instead of dying of it, which is Go's default for that signal.
func TestRunHandlesNotify(t *testing.T) {
	p := filepath.Join(t.TempDir(), "config")
	if err := config.Save(p, config.Config{Site: "http://localhost:4321", Network: config.Stagenet, Node: "http://127.0.0.1:38081", DataDir: "/tmp/x", AllowSameMachine: true}); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	var out syncBuffer
	done := make(chan int)
	go func() { done <- realMain(ctx, []string{"run", "--config", p}, &out, &out) }()
	waitText(t, &out, "msg=starting")
	syscall.Kill(os.Getpid(), syscall.SIGUSR1)
	waitText(t, &out, "msg=notified")
	cancel()
	if code := <-done; code != 0 {
		t.Fatalf("run: %d", code)
	}
}

type syncBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}
func (s *syncBuffer) String() string { s.mu.Lock(); defer s.mu.Unlock(); return s.b.String() }

func waitText(t *testing.T, b *syncBuffer, want string) {
	t.Helper()
	for deadline := time.Now().Add(3 * time.Second); !strings.Contains(b.String(), want); {
		if time.Now().After(deadline) {
			t.Fatalf("no %q in %q", want, b.String())
		}
		time.Sleep(10 * time.Millisecond)
	}
}
