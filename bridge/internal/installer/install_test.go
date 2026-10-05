package installer

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/config"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/noderpc"
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
	want := config.Config{Site: "https://shop.example", Network: config.Stagenet, Address: stagenetAddr, Node: "http://127.0.0.1:38081", DataDir: p.DataDir(), AutoUpdate: true}
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
	if target, err := os.Readlink(p.Link()); err != nil || target != "/var/lib/xmr-bridge/bin/xmr-bridge" {
		t.Fatalf("symlink %q %v", target, err)
	}
	if fi, _ := os.Stat(p.DataDir()); fi.Mode().Perm() != 0o700 {
		t.Fatalf("data folder mode %v", fi.Mode().Perm())
	}
	// The user, the steps in order, wallet-rpc as the service account.
	if !sys.has("useradd xmr-bridge /var/lib/xmr-bridge") {
		t.Fatalf("calls %v", sys.calls)
	}
	if strings.Join(st.order, ",") != "wallet-rpc,wallet,pair" {
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
		t.Fatal("symlink kept")
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

func TestUnit(t *testing.T) {
	u := UnitText()
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
