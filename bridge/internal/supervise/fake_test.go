package supervise

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"testing"
	"time"
)

// TestMain doubles as a fake monero-wallet-rpc when XMR_FAKE_WALLET_RPC is set: the supervisor tests start the
// test binary itself as the child. Behaviour comes from XMR_FAKE_MODE; what it saw is written to XMR_FAKE_RECORD.
func TestMain(m *testing.M) {
	if os.Getenv("XMR_FAKE_WALLET_RPC") == "1" {
		os.Exit(fakeWalletRPC(os.Args[1:]))
	}
	if os.Getenv("XMR_FAKE_BRIDGE") == "1" {
		os.Exit(fakeBridge())
	}
	os.Exit(m.Run())
}

type fakeRecord struct {
	Args       []string `json:"args"`
	Env        []string `json:"env"`
	ConfMode   string   `json:"confMode"`
	ConfLines  int      `json:"confLines"`
	User       string   `json:"user"`
	PassMD5    string   `json:"passMd5"` // a hash of the password, so tests can compare starts without seeing it
	PassInArgs bool     `json:"passInArgs"`
	PID        int      `json:"pid"`
}

func fakeWalletRPC(args []string) int {
	fs := flag.NewFlagSet("fake", flag.ContinueOnError)
	conf := fs.String("config-file", "", "")
	port := fs.Int("rpc-bind-port", 0, "")
	ip := fs.String("rpc-bind-ip", "", "")
	for _, name := range []string{"wallet-dir", "shared-ringdb-dir", "log-file", "max-log-file-size", "max-log-files", "daemon-address", "daemon-ssl", "tx-notify"} {
		fs.String(name, "", "")
	}
	for _, name := range []string{"non-interactive", "stagenet", "testnet"} {
		fs.Bool(name, false, "")
	}
	if err := fs.Parse(args); err != nil || fs.NArg() != 0 {
		fmt.Fprintln(os.Stderr, "fake: bad arguments:", err)
		return 2
	}
	rec := fakeRecord{Args: args, Env: os.Environ(), PID: os.Getpid()}
	fi, err := os.Stat(*conf)
	if err != nil {
		fmt.Fprintln(os.Stderr, "fake: no config file")
		return 3
	}
	rec.ConfMode = fi.Mode().Perm().String()
	data, _ := os.ReadFile(*conf)
	var user, pass string
	for _, line := range strings.Split(strings.TrimSpace(string(data)), "\n") {
		rec.ConfLines++
		if v, ok := strings.CutPrefix(line, "rpc-login="); ok {
			user, pass, _ = strings.Cut(v, ":")
		}
	}
	rec.User = user
	h := md5.Sum([]byte(pass))
	rec.PassMD5 = hex.EncodeToString(h[:])
	for _, a := range args {
		rec.PassInArgs = rec.PassInArgs || (pass != "" && strings.Contains(a, pass))
	}
	if p := os.Getenv("XMR_FAKE_RECORD"); p != "" {
		f, _ := os.OpenFile(p, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
		json.NewEncoder(f).Encode(rec)
		f.Close()
	}

	mode := os.Getenv("XMR_FAKE_MODE")
	if mode == "exit-at-once" {
		fmt.Fprintln(os.Stderr, "fake: failing at start")
		return 1
	}
	if mode == "ignore-term" {
		signal.Ignore(syscall.SIGTERM)
	}
	ln, err := net.Listen("tcp", fmt.Sprintf("%s:%d", *ip, *port))
	if err != nil {
		fmt.Fprintln(os.Stderr, "fake: listen:", err)
		return 4
	}
	const nonce = "ZmFrZS1ub25jZQ=="
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if mode == "never-ready" {
			http.Error(w, "busy", http.StatusServiceUnavailable)
			return
		}
		p := map[string]string{}
		if rest, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Digest "); ok {
			for _, part := range strings.Split(rest, ", ") {
				k, v, _ := strings.Cut(part, "=")
				p[k] = strings.Trim(v, `"`)
			}
		}
		md := func(s string) string { x := md5.Sum([]byte(s)); return hex.EncodeToString(x[:]) }
		want := md(strings.Join([]string{md(user + ":monero-rpc:" + pass), nonce, p["nc"], p["cnonce"], "auth", md("POST:/json_rpc")}, ":"))
		if p["username"] != user || p["nonce"] != nonce || p["response"] != want {
			w.Header().Add("WWW-Authenticate", `Digest qop="auth",algorithm=MD5,realm="monero-rpc",nonce="`+nonce+`",stale=false`)
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		io.Copy(io.Discard, r.Body)
		io.WriteString(w, `{"jsonrpc":"2.0","id":"0","result":{"version":65562,"release":true}}`)
	})}
	go srv.Serve(ln)
	if mode == "crash-after-ready" {
		time.Sleep(300 * time.Millisecond)
		fmt.Fprintln(os.Stderr, "fake: crashing on purpose")
		return 7
	}
	if mode == "ignore-term" {
		select {} // only SIGKILL ends it
	}
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGTERM, syscall.SIGINT)
	<-sig
	return 0
}

// fakeBridge runs a supervisor (with this binary as a fake wallet-rpc) and writes the child's pid to
// XMR_FAKE_PIDFILE once it is ready; the test then kills this process outright.
func fakeBridge() int {
	self, _ := os.Executable()
	s, err := New(Options{
		Binary: self, DataDir: os.Getenv("XMR_FAKE_DATA"), Network: "stagenet", Node: "http://127.0.0.1:38081",
		Env: []string{"XMR_FAKE_WALLET_RPC=1"},
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	go s.Run(context.Background())
	if _, err := s.WaitReady(context.Background()); err != nil {
		return 1
	}
	os.WriteFile(os.Getenv("XMR_FAKE_PIDFILE"), []byte(fmt.Sprint(s.Status().PID)), 0o600)
	select {}
}
