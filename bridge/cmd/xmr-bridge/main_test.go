package main

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
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
