package installer

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/config"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/noderpc"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/selfupdate"
)

func TestInstall(t *testing.T) {
	opts, sys, tty, st := harness(t)
	if err := Install(context.Background(), opts, sys, tty, st.steps(sys)); err != nil {
		t.Fatalf("%v\n%s", err, tty.said.String())
	}
	p := opts.Paths
	// Config: what the bridge needs, owned by the service account, mode 600.
	cfg, err := config.Load(p.Config())
	if err != nil {
		t.Fatal(err)
	}
	// The restore height is written down: with no flag and nothing suggested by the site, the node's height (today).
	want := config.Config{Site: "https://shop.example", Network: config.Stagenet, Address: stagenetAddr, Node: "http://127.0.0.1:38081", DataDir: p.DataDir(), RestoreHeight: 2222000, AutoUpdate: true}
	if cfg != want {
		t.Fatalf("config\n got %+v\nwant %+v", cfg, want)
	}
	if sys.chowned[p.Config()] != [2]int{991, 991} {
		t.Fatal("config not handed to the service account")
	}
	// The bridge binary in the data folder, a symlink for the admin.
	b, _ := os.ReadFile(p.Binary())
	if string(b) != "#!bridge binary\n" {
		t.Fatal("binary not copied")
	}
	if fi, _ := os.Stat(p.Binary()); fi.Mode().Perm() != 0o755 {
		t.Fatalf("binary mode %v", fi.Mode().Perm())
	}
	// The admin copy: a root-owned file (never a link into a folder the service can write), its hash recorded.
	if fi, err := os.Lstat(p.Link()); err != nil || !fi.Mode().IsRegular() || fi.Mode().Perm() != 0o755 {
		t.Fatalf("admin copy %v %v", fi, err)
	}
	if b, _ := os.ReadFile(p.Link()); string(b) != "#!bridge binary\n" {
		t.Fatal("admin copy content")
	}
	if sys.chowned[p.Link()] != [2]int{0, 0} {
		t.Fatal("admin copy not root-owned")
	}
	if h, err := os.ReadFile(filepath.Join(p.EtcDir(), "admin-binary.sha256")); err != nil || len(strings.TrimSpace(string(h))) != 64 {
		t.Fatalf("admin copy hash not recorded: %q %v", h, err)
	}
	// The update guard, run by systemd as the service user.
	if g, err := os.ReadFile(filepath.Join(p.BinDir(), "update-guard.sh")); err != nil || string(g) != selfupdate.GuardScript {
		t.Fatalf("guard %v", err)
	}
	if fi, _ := os.Stat(filepath.Join(p.BinDir(), "update-guard.sh")); fi.Mode().Perm() != 0o755 {
		t.Fatalf("guard mode %v", fi.Mode().Perm())
	}
	if fi, _ := os.Stat(p.DataDir()); fi.Mode().Perm() != 0o700 {
		t.Fatalf("data folder mode %v", fi.Mode().Perm())
	}
	// The user, the steps in order, wallet-rpc as the service account.
	if !sys.has("useradd xmr-bridge /var/lib/xmr-bridge") {
		t.Fatalf("calls %v", sys.calls)
	}
	// Pairing comes before the wallet, so the site's suggested restore height can be used (spec change 17).
	if strings.Join(st.order, ",") != "wallet-rpc,pair,wallet" {
		t.Fatalf("order %v", st.order)
	}
	if st.walletCred == nil || st.walletCred.Uid != 991 || st.walletCred.Gid != 991 || st.walletCred.NoSetGroups {
		t.Fatalf("wallet-rpc must run as the service account, with root's groups dropped: %+v", st.walletCred)
	}
	if st.walletKey != viewKey || st.pairCode != code {
		t.Fatal("the typed view key or the code didn't reach the steps")
	}
	if sys.chowned[p.DataDir()] != [2]int{991, 991} {
		t.Fatal("data folder not handed to the service account")
	}
	// The unit, then systemd.
	unit, err := os.ReadFile(p.Unit())
	if err != nil || !strings.Contains(string(unit), "ExecStart=/var/lib/xmr-bridge/bin/xmr-bridge run --config /etc/xmr-bridge/config") {
		t.Fatalf("unit %s %v", unit, err)
	}
	if !sys.has("systemctl daemon-reload") || !sys.has("systemctl enable --now xmr-bridge.service") {
		t.Fatalf("calls %v", sys.calls)
	}
	// The prompts: address, then the view key (hidden); no node prompt (the local node answered).
	if len(tty.asked) != 2 || !strings.Contains(tty.asked[0], "address") || !strings.Contains(tty.asked[1], "view key") {
		t.Fatalf("asked %q", tty.asked)
	}
	if strings.Contains(tty.said.String(), viewKey) {
		t.Fatal("the view key was printed")
	}
	if !strings.Contains(tty.said.String(), "xmr-bridge status") {
		t.Fatalf("no closing hint: %s", tty.said.String())
	}
}

func TestInstallRefusesEarly(t *testing.T) {
	for name, tweak := range map[string]func(*Options, *fakeSystem){
		"not root":   func(o *Options, s *fakeSystem) { s.euid = 1000 },
		"no systemd": func(o *Options, s *fakeSystem) { s.systemd = false },
		"bad code":   func(o *Options, s *fakeSystem) { o.Code = "short" },
		"no code":    func(o *Options, s *fakeSystem) { o.Code = "" },
		"bad site":   func(o *Options, s *fakeSystem) { o.Site = "http://shop.example" },
	} {
		t.Run(name, func(t *testing.T) {
			opts, sys, tty, st := harness(t)
			tweak(&opts, sys)
			if err := Install(context.Background(), opts, sys, tty, st.steps(sys)); err == nil {
				t.Fatal("installed")
			}
			if len(tty.asked) != 0 || len(sys.calls) != 0 || len(st.order) != 0 {
				t.Fatalf("did things before refusing: asked %v calls %v steps %v", tty.asked, sys.calls, st.order)
			}
			if e, _ := os.ReadDir(opts.Paths.Root); len(e) != 0 {
				t.Fatalf("wrote files: %v", e)
			}
		})
	}
}

func TestPromptRetries(t *testing.T) {
	opts, sys, tty, st := harness(t)
	tty.answers = []string{"not an address", mainnetAddr + "x", stagenetAddr}
	tty.secrets = []string{"abbey abbey abbey", spendKey, viewKey}
	if err := Install(context.Background(), opts, sys, tty, st.steps(sys)); err != nil {
		t.Fatal(err)
	}
	said := tty.said.String()
	if !strings.Contains(said, "SPEND key") || !strings.Contains(said, "seed") {
		t.Fatalf("messages: %s", said)
	}
	if st.walletKey != viewKey {
		t.Fatal("wrong key used")
	}
}

func TestPromptGivesUp(t *testing.T) {
	opts, sys, tty, st := harness(t)
	tty.answers = []string{"x", "y", "z", stagenetAddr}
	if err := Install(context.Background(), opts, sys, tty, st.steps(sys)); err == nil {
		t.Fatal("accepted after three bad addresses")
	}
	if len(st.order) != 0 || len(sys.calls) != 0 {
		t.Fatal("went on after giving up")
	}
}

func TestMainnetAddressSetsTheNetwork(t *testing.T) {
	opts, sys, tty, st := harness(t)
	tty.answers = []string{mainnetAddr}
	st.nodes = map[string]noderpc.Info{"http://127.0.0.1:18081": {NetType: "mainnet", Height: 3300000}}
	if err := Install(context.Background(), opts, sys, tty, st.steps(sys)); err != nil {
		t.Fatal(err)
	}
	if st.walletCfg.Network != config.Mainnet || st.walletCfg.Node != "http://127.0.0.1:18081" {
		t.Fatalf("cfg %+v", st.walletCfg)
	}
}

func TestLocalNodeOnIPv6(t *testing.T) {
	opts, sys, tty, st := harness(t)
	st.nodes = map[string]noderpc.Info{"http://[::1]:38081": {NetType: "stagenet", Height: 1}}
	if err := Install(context.Background(), opts, sys, tty, st.steps(sys)); err != nil {
		t.Fatal(err)
	}
	if st.walletCfg.Node != "http://[::1]:38081" {
		t.Fatalf("node %s", st.walletCfg.Node)
	}
}

func TestNodePrompt(t *testing.T) {
	opts, sys, tty, st := harness(t)
	st.nodes = map[string]noderpc.Info{
		"https://wrongnet.example:18089": {NetType: "mainnet", Height: 1},
		"https://node.example:38089":     {NetType: "stagenet", Height: 1},
	}
	tty.answers = []string{stagenetAddr, "https://down.example:38089", "https://wrongnet.example:18089", "https://node.example:38089"}
	if err := Install(context.Background(), opts, sys, tty, st.steps(sys)); err != nil {
		t.Fatalf("%v\n%s", err, tty.said.String())
	}
	if st.walletCfg.Node != "https://node.example:38089" {
		t.Fatalf("node %s", st.walletCfg.Node)
	}
	said := tty.said.String()
	if !strings.Contains(said, "mainnet") || !strings.Contains(strings.ToLower(said), "doesn't answer") {
		t.Fatalf("messages %s", said)
	}
}

func TestNodeFlag(t *testing.T) {
	opts, sys, tty, st := harness(t)
	opts.Node = "https://node.example:38089"
	st.nodes = map[string]noderpc.Info{"https://node.example:38089": {NetType: "stagenet", Height: 1}}
	if err := Install(context.Background(), opts, sys, tty, st.steps(sys)); err != nil {
		t.Fatal(err)
	}
	if st.walletCfg.Node != "https://node.example:38089" || len(tty.asked) != 2 {
		t.Fatalf("node %s, asked %v", st.walletCfg.Node, tty.asked)
	}
}

func TestSameMachine(t *testing.T) {
	opts, sys, tty, st := harness(t)
	st.signals = []string{"a running site process (astro dev)"}
	err := Install(context.Background(), opts, sys, tty, st.steps(sys))
	if err == nil || !strings.Contains(err.Error(), "astro dev") || !strings.Contains(err.Error(), "separate machine") {
		t.Fatalf("got %v", err)
	}
	if len(sys.calls) != 0 {
		t.Fatal("changed the machine")
	}
	// The stagenet-only development flag.
	opts, sys, tty, st = harness(t)
	st.signals = []string{"a running site process (astro dev)"}
	opts.AllowSameMachine = true
	if err := Install(context.Background(), opts, sys, tty, st.steps(sys)); err != nil {
		t.Fatal(err)
	}
	if cfg, _ := config.Load(opts.Paths.Config()); !cfg.AllowSameMachine {
		t.Fatal("the flag wasn't recorded")
	}
	// Refused on mainnet.
	opts, sys, tty, st = harness(t)
	opts.AllowSameMachine = true
	tty.answers = []string{mainnetAddr}
	st.nodes = map[string]noderpc.Info{"http://127.0.0.1:18081": {NetType: "mainnet", Height: 1}}
	if err := Install(context.Background(), opts, sys, tty, st.steps(sys)); err == nil || !strings.Contains(err.Error(), "stagenet") {
		t.Fatalf("mainnet with the dev flag: %v", err)
	}
}

func TestRunAgain(t *testing.T) {
	opts, sys, tty, st := harness(t)
	if err := Install(context.Background(), opts, sys, tty, st.steps(sys)); err != nil {
		t.Fatal(err)
	}
	// Same address again (a new code from the admin page): the wallet is kept, pairing and the service redone.
	tty2 := &fakeTTY{answers: []string{stagenetAddr}, secrets: []string{viewKey}}
	st2 := &fakeSteps{nodes: stagenetNode()}
	if err := Install(context.Background(), opts, sys, tty2, st2.steps(sys)); err != nil {
		t.Fatal(err)
	}
	if strings.Join(st2.order, ",") != "pair" {
		t.Fatalf("second run steps %v (the existing wallet-rpc and wallet should be kept)", st2.order)
	}
	if !sys.has("systemctl restart xmr-bridge.service") {
		t.Fatalf("calls %v", sys.calls)
	}
	// Another address: refused, pointing at uninstall.
	tty3 := &fakeTTY{answers: []string{mainnetAddr}, secrets: []string{viewKey}}
	st3 := &fakeSteps{nodes: map[string]noderpc.Info{"http://127.0.0.1:18081": {NetType: "mainnet", Height: 1}}}
	if err := Install(context.Background(), opts, sys, tty3, st3.steps(sys)); err == nil || !strings.Contains(err.Error(), "uninstall") {
		t.Fatalf("another address: %v", err)
	}
}

func TestRestoreHeight(t *testing.T) {
	// Spec change 17: the site's suggestion when no --restore-height is given; the flag otherwise, with a warning if
	// it is newer than the site's oldest watched invoice.
	for _, c := range []struct {
		name          string
		flag, suggest uint64
		want          uint64
		warn          bool
	}{
		{"suggested", 0, 2221280, 2221280, false},
		{"none suggested: today", 0, 0, 2222000, false},
		{"flag below the suggestion", 2220000, 2221280, 2220000, false},
		{"flag above the suggestion", 2221900, 2221280, 2221900, true},
	} {
		t.Run(c.name, func(t *testing.T) {
			opts, sys, tty, st := harness(t)
			opts.RestoreHeight, st.suggest = c.flag, c.suggest
			if err := Install(context.Background(), opts, sys, tty, st.steps(sys)); err != nil {
				t.Fatalf("%v\n%s", err, tty.said.String())
			}
			cfg, err := config.Load(opts.Paths.Config())
			if err != nil || cfg.RestoreHeight != c.want || st.walletCfg.RestoreHeight != c.want {
				t.Fatalf("restore height: config %d, wallet %d, want %d (%v)", cfg.RestoreHeight, st.walletCfg.RestoreHeight, c.want, err)
			}
			if sys.chowned[opts.Paths.Config()] != [2]int{991, 991} {
				t.Fatal("config not handed to the service account")
			}
			if warned := strings.Contains(tty.said.String(), "uninstall --delete-data"); warned != c.warn {
				t.Fatalf("warning %v, want %v:\n%s", warned, c.warn, tty.said.String())
			}
		})
	}
}

func TestRestoreHeightKeptWallet(t *testing.T) {
	// A kept wallet keeps its restore height; when the site's oldest watched invoice is older, the installer says how
	// to start over, and changes nothing else.
	opts, sys, tty, st := harness(t)
	if err := Install(context.Background(), opts, sys, tty, st.steps(sys)); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		suggest uint64
		warn    bool
	}{{2223000, false}, {2221280, true}} {
		tty2 := &fakeTTY{answers: []string{stagenetAddr}, secrets: []string{viewKey}}
		st2 := &fakeSteps{nodes: stagenetNode(), suggest: c.suggest}
		if err := Install(context.Background(), opts, sys, tty2, st2.steps(sys)); err != nil {
			t.Fatal(err)
		}
		if strings.Join(st2.order, ",") != "pair" {
			t.Fatalf("steps %v", st2.order)
		}
		if cfg, _ := config.Load(opts.Paths.Config()); cfg.RestoreHeight != 2222000 {
			t.Fatalf("the kept wallet's restore height changed: %d", cfg.RestoreHeight)
		}
		if warned := strings.Contains(tty2.said.String(), "uninstall --delete-data"); warned != c.warn {
			t.Fatalf("suggest %d: warning %v, want %v:\n%s", c.suggest, warned, c.warn, tty2.said.String())
		}
	}
}

func TestWalletFailsAfterPairing(t *testing.T) {
	// The code is spent by then: the error says to get a new one before running the installer again.
	opts, sys, tty, st := harness(t)
	st.walletErr = errors.New("wallet-rpc refused")
	err := Install(context.Background(), opts, sys, tty, st.steps(sys))
	if err == nil || !strings.Contains(err.Error(), "wallet-rpc refused") || !strings.Contains(err.Error(), "Connect wallet host") {
		t.Fatalf("got %v", err)
	}
}

func TestForeignFileAtTheLink(t *testing.T) {
	opts, sys, tty, st := harness(t)
	os.MkdirAll(filepath.Dir(opts.Paths.Link()), 0o755)
	os.WriteFile(opts.Paths.Link(), []byte("someone else's program"), 0o755)
	if err := Install(context.Background(), opts, sys, tty, st.steps(sys)); err == nil || !strings.Contains(err.Error(), opts.Paths.Link()) {
		t.Fatalf("got %v", err)
	}
	if b, _ := os.ReadFile(opts.Paths.Link()); string(b) != "someone else's program" {
		t.Fatal("overwrote a file it didn't make")
	}
}

func TestUninstall(t *testing.T) {
	opts, sys, tty, st := harness(t)
	if err := Install(context.Background(), opts, sys, tty, st.steps(sys)); err != nil {
		t.Fatal(err)
	}
	var out strings.Builder
	if err := Uninstall(opts.Paths, false, sys, &out); err != nil {
		t.Fatal(err)
	}
	p := opts.Paths
	if _, err := os.Lstat(p.Unit()); !os.IsNotExist(err) {
		t.Fatal("unit kept")
	}
	if _, err := os.Lstat(p.Link()); !os.IsNotExist(err) {
		t.Fatal("admin copy kept")
	}
	if _, err := os.Stat(filepath.Join(p.DataDir(), "wallet", "shop.keys")); err != nil {
		t.Fatal("the wallet was removed without --delete-data")
	}
	if !sys.has("systemctl disable --now xmr-bridge.service") || sys.has("userdel") {
		t.Fatalf("calls %v", sys.calls)
	}
	if !strings.Contains(out.String(), "/var/lib/xmr-bridge") || !strings.Contains(out.String(), "--delete-data") {
		t.Fatalf("output %s", out.String())
	}

	out.Reset()
	if err := Uninstall(opts.Paths, true, sys, &out); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{p.DataDir(), p.EtcDir()} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("%s kept with --delete-data", path)
		}
	}
	if !sys.has("userdel xmr-bridge") {
		t.Fatal("user kept with --delete-data")
	}
}

// The 3f layout had a symlink; installing again replaces it with the root-owned copy.
func TestReplacesOldSymlink(t *testing.T) {
	opts, sys, tty, st := harness(t)
	os.MkdirAll(filepath.Dir(opts.Paths.Link()), 0o755)
	os.Symlink("/var/lib/xmr-bridge/bin/xmr-bridge", opts.Paths.Link())
	if err := Install(context.Background(), opts, sys, tty, st.steps(sys)); err != nil {
		t.Fatal(err)
	}
	if fi, _ := os.Lstat(opts.Paths.Link()); !fi.Mode().IsRegular() {
		t.Fatal("the old symlink wasn't replaced")
	}
}

// A changed admin copy (not the one the installer recorded) is left alone by uninstall.
func TestUninstallLeavesAChangedAdminCopy(t *testing.T) {
	opts, sys, tty, st := harness(t)
	if err := Install(context.Background(), opts, sys, tty, st.steps(sys)); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(opts.Paths.Link(), []byte("replaced by someone"), 0o755)
	var out strings.Builder
	if err := Uninstall(opts.Paths, false, sys, &out); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(opts.Paths.Link()); string(b) != "replaced by someone" {
		t.Fatal("removed a file it didn't install")
	}
}

// The admin copy refuses to act on a state written by a newer bridge (it may lag after a self-update).
func TestUninstallChecksStateFormat(t *testing.T) {
	opts, sys, tty, st := harness(t)
	if err := Install(context.Background(), opts, sys, tty, st.steps(sys)); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(opts.Paths.DataDir(), "run", "update-state.json"), []byte(`{"format":99}`), 0o600)
	var out strings.Builder
	err := Uninstall(opts.Paths, false, sys, &out)
	if err == nil || !strings.Contains(strings.ToLower(err.Error()), "re-run the installer") {
		t.Fatalf("got %v", err)
	}
	if _, err := os.Stat(opts.Paths.Unit()); err != nil {
		t.Fatal("removed the service anyway")
	}
}

func TestUnit(t *testing.T) {
	u := UnitText()
	unitSection, serviceSection, _ := strings.Cut(u, "[Service]")
	for _, want := range []string{"StartLimitIntervalSec=600", "StartLimitBurst=20"} {
		if !strings.Contains(unitSection, want) {
			t.Errorf("[Unit] lacks %q", want)
		}
	}
	for _, want := range []string{"ExecStartPre=/var/lib/xmr-bridge/bin/update-guard.sh\n", "RestartForceExitStatus=75", "RestartSec=10"} {
		if !strings.Contains(serviceSection, want) {
			t.Errorf("[Service] lacks %q", want)
		}
	}
	if strings.Contains(u, "ExecStartPre=+") || strings.Contains(u, "ExecStartPre=!") {
		t.Error("the guard must run as the service user, not with root privileges")
	}
	for _, want := range []string{
		"User=xmr-bridge", "Group=xmr-bridge", "NoNewPrivileges=yes", "ProtectSystem=strict", "ReadWritePaths=/var/lib/xmr-bridge",
		"ProtectHome=yes", "PrivateTmp=yes", "PrivateDevices=yes", "RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX",
		"CapabilityBoundingSet=\n", "UMask=0077", "SystemCallFilter=@system-service", "MemoryDenyWriteExecute=yes",
		"ProtectProc=invisible", "RemoveIPC=yes", "Restart=on-failure", "WantedBy=multi-user.target",
		"ExecStart=/var/lib/xmr-bridge/bin/xmr-bridge run --config /etc/xmr-bridge/config",
	} {
		if !strings.Contains(u, want) {
			t.Errorf("unit lacks %q", want)
		}
	}
}
