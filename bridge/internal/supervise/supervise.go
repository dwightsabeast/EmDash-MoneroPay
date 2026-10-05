// Package supervise runs monero-wallet-rpc as a child of the bridge and keeps it running (spec, Bridge service,
// duties 1 and 8): bound to localhost, with a login generated at every start and passed in a mode-600
// --config-file (never on the command line; the file is removed once wallet-rpc answers), restarted with backoff
// when it exits, and stopped with SIGTERM then SIGKILL. The child dies with the bridge (Linux parent-death signal).
package supervise

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/config"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/secret"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/walletrpc"
)

const rpcUser = "xmr-bridge"

// Options configures the supervisor. Zero durations take the defaults.
type Options struct {
	Binary  string // absolute path to monero-wallet-rpc
	DataDir string // absolute; run/, wallet/, ringdb/ and log/ are created under it
	Network config.Network
	Node    string // monerod RPC URL, http or https, with a port
	// NotifyCommand runs for each new incoming transaction (--tx-notify), with the txid appended. Its parts may not
	// contain spaces or '%': wallet-rpc splits the command on spaces.
	NotifyCommand []string
	// Env is the child's whole environment (nothing is inherited).
	Env []string
	Log *slog.Logger
	// Credential, when set, runs wallet-rpc as that account (the installer runs as root but wallet-rpc never does);
	// the login file is handed to the account so it can read it.
	Credential *syscall.Credential
	// Init runs on every start once wallet-rpc answers, before the supervisor reports ready (it opens the wallet).
	// An error fails that start: the child is stopped and restarted with backoff.
	Init func(ctx context.Context, c *walletrpc.Client) error

	ReadyTimeout time.Duration // default 60 s
	StopTimeout  time.Duration // default 30 s
	BackoffMin   time.Duration // default 1 s
	BackoffMax   time.Duration // default 60 s
	StableAfter  time.Duration // default 5 min: a run this long resets the backoff
}

// Status describes the child for `xmr-bridge status` and the health checks.
type Status struct {
	Running  bool
	Ready    bool
	PID      int
	Port     int
	Since    time.Time
	Restarts int
	LastExit string
}

// Supervisor runs one monero-wallet-rpc at a time.
type Supervisor struct {
	o          Options
	daemonAddr string
	daemonSSL  string
	notify     string

	owner *[2]int // uid, gid the login file was handed to (tests)

	mu      sync.Mutex
	st      Status
	client  *walletrpc.Client
	readyCh chan struct{} // closed while a ready child is running
}

// New checks the options.
func New(o Options) (*Supervisor, error) {
	if !filepath.IsAbs(o.Binary) || !filepath.IsAbs(o.DataDir) {
		return nil, errors.New("supervise: binary and data directory must be absolute paths")
	}
	switch o.Network {
	case config.Mainnet, config.Stagenet, config.Testnet:
	default:
		return nil, fmt.Errorf("supervise: unknown network %q", o.Network)
	}
	u, err := url.Parse(o.Node)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.Port() == "" {
		return nil, errors.New("supervise: node must be an http or https URL with a port")
	}
	s := &Supervisor{o: o, daemonAddr: u.Host, daemonSSL: "disabled", readyCh: make(chan struct{})}
	if u.Scheme == "https" {
		s.daemonSSL = "enabled"
	}
	if len(o.NotifyCommand) > 0 {
		if !filepath.IsAbs(o.NotifyCommand[0]) {
			return nil, errors.New("supervise: the notify command must start with an absolute path")
		}
		for _, p := range o.NotifyCommand {
			if p == "" || strings.ContainsAny(p, " \t\n%") {
				return nil, errors.New("supervise: notify command parts may not contain spaces or '%'")
			}
		}
		s.notify = strings.Join(o.NotifyCommand, " ") + " %s"
	}
	def := func(d *time.Duration, v time.Duration) {
		if *d <= 0 {
			*d = v
		}
	}
	def(&s.o.ReadyTimeout, 60*time.Second)
	def(&s.o.StopTimeout, 30*time.Second)
	def(&s.o.BackoffMin, time.Second)
	def(&s.o.BackoffMax, 60*time.Second)
	def(&s.o.StableAfter, 5*time.Minute)
	if s.o.Log == nil {
		s.o.Log = slog.New(slog.NewTextHandler(io.Discard, nil))
	}
	if s.o.Env == nil {
		s.o.Env = []string{} // nil would make exec inherit the bridge's environment
	}
	return s, nil
}

// Status returns a copy of the current status.
func (s *Supervisor) Status() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.st
}

// WaitReady returns a client for the running wallet-rpc once it answers, or ctx's error.
func (s *Supervisor) WaitReady(ctx context.Context) (*walletrpc.Client, error) {
	for {
		s.mu.Lock()
		c, ch := s.client, s.readyCh
		s.mu.Unlock()
		if c != nil {
			return c, nil
		}
		select {
		case <-ch:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
}

// Run starts wallet-rpc and keeps it running until ctx ends, then stops it. It returns nil after a clean stop.
func (s *Supervisor) Run(ctx context.Context) error {
	var backoff time.Duration
	for {
		if ctx.Err() != nil {
			return nil
		}
		began := time.Now()
		err := s.runOnce(ctx)
		if ctx.Err() != nil {
			return nil
		}
		backoff = nextBackoff(backoff, time.Since(began), s.o.BackoffMin, s.o.BackoffMax, s.o.StableAfter)
		s.mu.Lock()
		s.st.Restarts++
		s.st.LastExit = err.Error()
		s.mu.Unlock()
		s.o.Log.Warn("wallet-rpc stopped; restarting", "err", err, "in", backoff)
		select {
		case <-time.After(backoff):
		case <-ctx.Done():
			return nil
		}
	}
}

// nextBackoff doubles the delay up to max, and starts over at min after a run of at least stable.
func nextBackoff(prev, ran, min, max, stable time.Duration) time.Duration {
	if prev == 0 || ran >= stable {
		return min
	}
	if prev*2 > max {
		return max
	}
	return prev * 2
}

// runOnce starts one child and returns when it exits (the error says why) or after stopping it when ctx ends.
func (s *Supervisor) runOnce(ctx context.Context) error {
	dirs := map[string]string{}
	for _, d := range []string{"run", "wallet", "ringdb", "log"} {
		p := filepath.Join(s.o.DataDir, d)
		if err := os.MkdirAll(p, 0o700); err != nil {
			return fmt.Errorf("data directory: %w", err)
		}
		if err := os.Chmod(p, 0o700); err != nil {
			return fmt.Errorf("data directory: %w", err)
		}
		dirs[d] = p
	}
	port, err := freePort()
	if err != nil {
		return fmt.Errorf("no free port: %w", err)
	}
	pass, err := randomSecret()
	if err != nil {
		return err
	}
	conf := filepath.Join(dirs["run"], "wallet-rpc.conf")
	defer os.Remove(conf)
	if err := writePrivate(conf, "rpc-login="+rpcUser+":"+pass.Reveal()+"\n"); err != nil {
		return fmt.Errorf("config file: %w", err)
	}
	if c := s.o.Credential; c != nil {
		if err := os.Chown(conf, int(c.Uid), int(c.Gid)); err != nil {
			return fmt.Errorf("config file: %w", err)
		}
		s.owner = &[2]int{int(c.Uid), int(c.Gid)}
	}

	args := []string{
		"--config-file", conf,
		"--rpc-bind-ip", "127.0.0.1",
		"--rpc-bind-port", strconv.Itoa(port),
		"--non-interactive",
		"--wallet-dir", dirs["wallet"],
		"--shared-ringdb-dir", dirs["ringdb"],
		"--log-file", filepath.Join(dirs["log"], "wallet-rpc.log"),
		"--max-log-file-size", strconv.Itoa(10 << 20),
		"--max-log-files", "2",
		"--daemon-address", s.daemonAddr,
		"--daemon-ssl", s.daemonSSL,
	}
	switch s.o.Network {
	case config.Stagenet:
		args = append(args, "--stagenet")
	case config.Testnet:
		args = append(args, "--testnet")
	}
	if s.notify != "" {
		args = append(args, "--tx-notify", s.notify)
	}
	tail := &tailBuffer{max: 2048}
	cmd := exec.Command(s.o.Binary, args...)
	cmd.Env = s.o.Env
	cmd.Dir = s.o.DataDir
	cmd.Stdout, cmd.Stderr = tail, tail
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true, Pdeathsig: syscall.SIGTERM, Credential: s.o.Credential}

	// The parent-death signal follows the thread that started the child, so that thread stays locked to this
	// goroutine until the child has exited.
	started, exited := make(chan error, 1), make(chan error, 1)
	go func() {
		runtime.LockOSThread()
		if err := cmd.Start(); err != nil {
			started <- err
			return
		}
		started <- nil
		exited <- cmd.Wait()
	}()
	if err := <-started; err != nil {
		return fmt.Errorf("start: %w", err)
	}
	pid := cmd.Process.Pid
	s.mu.Lock()
	s.st.Running, s.st.Ready, s.st.PID, s.st.Port, s.st.Since = true, false, pid, port, time.Now()
	s.mu.Unlock()
	defer s.clear()
	exitErr := func(err error) error {
		if err == nil {
			err = errors.New("exit status 0")
		}
		return fmt.Errorf("wallet-rpc exited (%v); last output: %q", err, tail.String())
	}

	client := walletrpc.New("http://127.0.0.1:"+strconv.Itoa(port), rpcUser, pass, &http.Client{Timeout: 5 * time.Second})
	deadline := time.NewTimer(s.o.ReadyTimeout)
	defer deadline.Stop()
	tick := time.NewTicker(200 * time.Millisecond)
	defer tick.Stop()
	for ready := false; !ready; {
		select {
		case err := <-exited:
			return exitErr(err)
		case <-ctx.Done():
			s.stop(pid, exited)
			return nil
		case <-deadline.C:
			s.stop(pid, exited)
			return fmt.Errorf("wallet-rpc not ready after %v; last output: %q", s.o.ReadyTimeout, tail.String())
		case <-tick.C:
			cctx, cancel := context.WithTimeout(ctx, 2*time.Second)
			_, err := client.GetVersion(cctx)
			cancel()
			ready = err == nil
		}
	}
	os.Remove(conf) // wallet-rpc has read its login
	if s.o.Init != nil {
		ictx, cancel := context.WithTimeout(ctx, s.o.ReadyTimeout)
		err := s.o.Init(ictx, client)
		cancel()
		if err != nil {
			s.stop(pid, exited)
			if ctx.Err() != nil {
				return nil
			}
			return fmt.Errorf("init: %w", err)
		}
	}
	s.mu.Lock()
	s.st.Ready = true
	s.client = client
	close(s.readyCh)
	s.mu.Unlock()
	s.o.Log.Info("wallet-rpc ready", "pid", pid, "port", port)

	select {
	case err := <-exited:
		return exitErr(err)
	case <-ctx.Done():
		s.stop(pid, exited)
		return nil
	}
}

// clear marks the child gone and makes WaitReady wait for the next one.
func (s *Supervisor) clear() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.st.Running, s.st.Ready, s.st.PID, s.st.Port = false, false, 0, 0
	if s.client != nil {
		s.client = nil
		s.readyCh = make(chan struct{})
	}
}

// stop sends SIGTERM to the child's process group, then SIGKILL after StopTimeout, and waits for the exit.
func (s *Supervisor) stop(pid int, exited <-chan error) {
	syscall.Kill(-pid, syscall.SIGTERM)
	select {
	case <-exited:
		return
	case <-time.After(s.o.StopTimeout):
	}
	s.o.Log.Warn("wallet-rpc ignored SIGTERM; killing it", "pid", pid)
	syscall.Kill(-pid, syscall.SIGKILL)
	<-exited
}

func freePort() (int, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer ln.Close()
	return ln.Addr().(*net.TCPAddr).Port, nil
}

func randomSecret() (secret.String, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return secret.String{}, err
	}
	return secret.New(base64.RawURLEncoding.EncodeToString(b)), nil
}

// writePrivate writes a file readable only by its owner, replacing any existing one.
func writePrivate(path, content string) error {
	os.Remove(path)
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	if _, err := f.WriteString(content); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

// tailBuffer keeps the last max bytes written to it.
type tailBuffer struct {
	mu  sync.Mutex
	max int
	b   []byte
}

func (t *tailBuffer) Write(p []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.b = append(t.b, p...)
	if len(t.b) > t.max {
		t.b = append([]byte(nil), t.b[len(t.b)-t.max:]...)
	}
	return len(p), nil
}

func (t *tailBuffer) String() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return strings.TrimSpace(string(t.b))
}
