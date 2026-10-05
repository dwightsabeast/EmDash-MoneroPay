package installer

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/config"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/edwards"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/noderpc"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/secret"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/testaddr"
)

// A made-up key pair (reduced scalars) and its stagenet and mainnet addresses.
const (
	viewKey  = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f00"
	spendKey = "a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf00"
	code     = "AbCdEfGhIjKlMnOpQrSt_-"
)

func pubs() ([]byte, []byte) {
	v, _ := hex.DecodeString(viewKey)
	s, _ := hex.DecodeString(spendKey)
	return edwards.ScalarBaseMult(s), edwards.ScalarBaseMult(v)
}

var (
	stagenetAddr = func() string { s, v := pubs(); return testaddr.FromKeys(24, s, v) }()
	mainnetAddr  = func() string { s, v := pubs(); return testaddr.FromKeys(18, s, v) }()
)

// fakeSystem records what the installer asks of the machine.
type fakeSystem struct {
	euid    int
	systemd bool
	users   map[string][2]int
	calls   []string
	chowned map[string][2]int
	failCtl bool
}

func newSystem() *fakeSystem {
	return &fakeSystem{systemd: true, users: map[string][2]int{}, chowned: map[string][2]int{}}
}

func (f *fakeSystem) Euid() int        { return f.euid }
func (f *fakeSystem) HasSystemd() bool { return f.systemd }
func (f *fakeSystem) LookupUser(name string) (int, int, bool, error) {
	u, ok := f.users[name]
	return u[0], u[1], ok, nil
}
func (f *fakeSystem) AddSystemUser(name, home string) error {
	f.calls = append(f.calls, "useradd "+name+" "+home)
	f.users[name] = [2]int{991, 991}
	return nil
}
func (f *fakeSystem) DeleteUser(name string) error {
	f.calls = append(f.calls, "userdel "+name)
	delete(f.users, name)
	return nil
}
func (f *fakeSystem) Chown(path string, uid, gid int) error {
	f.calls = append(f.calls, "chown "+filepath.Base(path))
	f.chowned[path] = [2]int{uid, gid}
	return nil
}
func (f *fakeSystem) Systemctl(args ...string) error {
	f.calls = append(f.calls, "systemctl "+strings.Join(args, " "))
	if f.failCtl {
		return errors.New("systemctl failed")
	}
	return nil
}

func (f *fakeSystem) has(prefix string) bool {
	for _, c := range f.calls {
		if strings.HasPrefix(c, prefix) {
			return true
		}
	}
	return false
}

// fakeTTY answers prompts in order and records what the installer said.
type fakeTTY struct {
	answers []string
	secrets []string
	asked   []string
	said    strings.Builder
}

func (p *fakeTTY) Ask(prompt string) (string, error) {
	p.asked = append(p.asked, prompt)
	if len(p.answers) == 0 {
		return "", errors.New("no more answers")
	}
	a := p.answers[0]
	p.answers = p.answers[1:]
	return a, nil
}
func (p *fakeTTY) AskSecret(prompt string) (secret.String, error) {
	p.asked = append(p.asked, prompt)
	if len(p.secrets) == 0 {
		return secret.String{}, errors.New("no more answers")
	}
	a := p.secrets[0]
	p.secrets = p.secrets[1:]
	return secret.New(a), nil
}
func (p *fakeTTY) Say(format string, a ...any) { fmt.Fprintf(&p.said, format+"\n", a...) }

// fakeSteps records the heavy steps.
type fakeSteps struct {
	nodes      map[string]noderpc.Info
	signals    []string
	order      []string
	walletCfg  config.Config
	walletCred *syscall.Credential
	walletKey  string
	pairCode   string
}

func (s *fakeSteps) steps(sys *fakeSystem) Steps {
	return Steps{
		NodeInfo: func(_ context.Context, u string) (noderpc.Info, error) {
			if i, ok := s.nodes[u]; ok {
				return i, nil
			}
			return noderpc.Info{}, errors.New("connection refused")
		},
		SameMachine: func(context.Context, string) []string { return s.signals },
		InstallWalletRPC: func(_ context.Context, binDir string) error {
			s.order = append(s.order, "wallet-rpc")
			os.MkdirAll(binDir, 0o755)
			return os.WriteFile(filepath.Join(binDir, "installed.json"), []byte("{}"), 0o644)
		},
		CreateWallet: func(_ context.Context, cfg config.Config, view secret.String, cred *syscall.Credential) error {
			s.order = append(s.order, "wallet")
			s.walletCfg, s.walletCred, s.walletKey = cfg, cred, view.Reveal()
			os.MkdirAll(filepath.Join(cfg.DataDir, "wallet"), 0o700)
			return os.WriteFile(filepath.Join(cfg.DataDir, "wallet", "shop.keys"), []byte("x"), 0o600)
		},
		Pair: func(_ context.Context, cfg config.Config, c string) error {
			s.order = append(s.order, "pair")
			s.pairCode = c
			return os.WriteFile(filepath.Join(cfg.DataDir, "bridge.key"), []byte("k"), 0o600)
		},
	}
}

func stagenetNode() map[string]noderpc.Info {
	return map[string]noderpc.Info{"http://127.0.0.1:38081": {NetType: "stagenet", Height: 2222000}}
}

// harness: a fake root with this test binary standing in for the bridge executable.
func harness(t *testing.T) (Options, *fakeSystem, *fakeTTY, *fakeSteps) {
	t.Helper()
	root := t.TempDir()
	exe := filepath.Join(t.TempDir(), "xmr-bridge")
	os.WriteFile(exe, []byte("#!bridge binary\n"), 0o755)
	opts := Options{Paths: Paths{Root: root}, Site: "https://shop.example", Code: code, Exe: exe}
	return opts, newSystem(), &fakeTTY{answers: []string{stagenetAddr}, secrets: []string{viewKey}}, &fakeSteps{nodes: stagenetNode()}
}
