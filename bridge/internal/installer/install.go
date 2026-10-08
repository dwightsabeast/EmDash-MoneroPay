// Package installer is `xmr-bridge install` and `uninstall` (spec, Bridge service, "The install command"; phase 03
// session 3f). install.sh only downloads and verifies the bridge and hands off here, so the cautious path
// (`xmr-bridge install --site … --pair …`) is the same. Everything that touches the machine goes through System,
// the terminal through Prompter, and the heavy steps through Steps, so the whole flow runs against a fake root in
// tests.
package installer

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"time"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/config"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/moneroaddr"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/noderpc"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/secret"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/selfupdate"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/shopkeys"
)

// System is everything the installer changes on the machine.
type System interface {
	Euid() int
	HasSystemd() bool
	LookupUser(name string) (uid, gid int, ok bool, err error)
	AddSystemUser(name, home string) error
	DeleteUser(name string) error
	Chown(path string, uid, gid int) error // recursive for folders; never follows symlinks
	Systemctl(args ...string) error
}

// Prompter is the admin's terminal (/dev/tty, so it works when the installer is piped from curl).
type Prompter interface {
	Ask(prompt string) (string, error)
	AskSecret(prompt string) (secret.String, error) // not echoed
	Say(format string, a ...any)
}

// Steps are the heavy parts (network, wallet-rpc), replaced in tests.
type Steps struct {
	NodeInfo         func(ctx context.Context, nodeURL string) (noderpc.Info, error)
	SameMachine      func(ctx context.Context, site string) []string
	InstallWalletRPC func(ctx context.Context, binDir string) error
	CreateWallet     func(ctx context.Context, cfg config.Config, view secret.String, cred *syscall.Credential) error
	// Pair pairs with the site and returns its suggested restore height for a new wallet (0: none).
	Pair func(ctx context.Context, cfg config.Config, code string) (uint64, error)
}

// Options are the install command's arguments.
type Options struct {
	Paths            Paths
	Site             string
	Code             string
	Node             string // optional: skip detection and the node prompt
	RestoreHeight    uint64
	NoAutoUpdate     bool
	AllowSameMachine bool   // development only, stagenet only
	Exe              string // the running bridge binary
}

const tries = 3

var codeRE = regexp.MustCompile(`^[A-Za-z0-9_-]{22}$`)

var defaultPorts = map[string]string{"mainnet": "18081", "stagenet": "38081", "testnet": "28081"}

// installLogPath is where the installer keeps what it said (never what the admin typed), for support and triage.
const installLogPath = dataDir + "/log/install.log"

// Install sets up the wallet host. It checks everything it can before changing anything, and can be run again. Once
// it has started changing the machine, it appends what it said to /var/lib/xmr-bridge/log/install.log, also when a
// later step fails; an early refusal leaves nothing behind.
func Install(ctx context.Context, o Options, sys System, tty Prompter, st Steps) error {
	rec := &recorder{Prompter: tty, started: time.Now().UTC()}
	changing := false
	err := install(ctx, o, sys, rec, st, &changing)
	if !changing {
		return err
	}
	if err != nil {
		rec.lines = append(rec.lines, "stopped: "+err.Error())
	}
	if werr := rec.write(o.Paths.at(installLogPath), o.Site); werr != nil {
		tty.Say("(couldn't write %s: %v)", installLogPath, werr)
	} else if err != nil {
		err = fmt.Errorf("%w (the installer's log: %s)", err, installLogPath)
	}
	return err
}

// recorder keeps what the installer says and asks; answers are never recorded.
type recorder struct {
	Prompter
	started time.Time
	lines   []string
}

func (r *recorder) Say(format string, a ...any) {
	r.lines = append(r.lines, fmt.Sprintf(format, a...))
	r.Prompter.Say(format, a...)
}

func (r *recorder) Ask(prompt string) (string, error) {
	a, err := r.Prompter.Ask(prompt)
	r.lines = append(r.lines, prompt+answered(err))
	return a, err
}

func (r *recorder) AskSecret(prompt string) (secret.String, error) {
	a, err := r.Prompter.AskSecret(prompt)
	r.lines = append(r.lines, prompt+answered(err))
	return a, err
}

func answered(err error) string {
	if err != nil {
		return "[no answer]"
	}
	return "[answered]"
}

func (r *recorder) write(path, site string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	fmt.Fprintf(f, "=== xmr-bridge install started %s (site %s)\n", r.started.Format(time.RFC3339), site)
	for _, l := range r.lines {
		fmt.Fprintln(f, l)
	}
	return f.Chmod(0o600)
}

func install(ctx context.Context, o Options, sys System, tty Prompter, st Steps, changing *bool) error {
	p := o.Paths
	if sys.Euid() != 0 {
		return errors.New("the installer needs root: run it with sudo")
	}
	if !sys.HasSystemd() {
		return errors.New("this machine doesn't run systemd; the wallet host needs a Linux machine with systemd")
	}
	if err := config.CheckSite(o.Site); err != nil {
		return fmt.Errorf("--site: %w", err)
	}
	if !codeRE.MatchString(o.Code) {
		return errors.New("--pair needs the 22-character code from the site's Connect wallet host button")
	}

	// The two values the admin types once.
	tty.Say("The shop wallet's details (typed here, never on a command line):")
	var addr, network string
	if err := retry(tty, func() error {
		a, err := tty.Ask("Primary address of the shop wallet: ")
		if err != nil {
			return errFatal{err}
		}
		a = strings.TrimSpace(a)
		net, kind, perr := moneroaddr.Parse(a)
		if perr != nil {
			return errors.New("that is not a Monero address; paste the shop wallet's primary address")
		}
		if kind != moneroaddr.Standard {
			return fmt.Errorf("that is a %s; paste the shop wallet's primary address", kind)
		}
		addr, network = a, net
		return nil
	}); err != nil {
		return err
	}
	var view secret.String
	if err := retry(tty, func() error {
		v, err := tty.AskSecret("Private view key of the shop wallet (hidden while you type): ")
		if err != nil {
			return errFatal{err}
		}
		v = secret.New(strings.ToLower(strings.TrimSpace(v.Reveal())))
		if err := shopkeys.CheckViewKey(v.Reveal()); err != nil {
			return err
		}
		if err := shopkeys.CheckViewKeyMatches(addr, v); err != nil {
			return err
		}
		view = v
		return nil
	}); err != nil {
		return err
	}

	// Never beside the site (spec, "Where the wallet host runs"), except with the stagenet-only development flag.
	if o.AllowSameMachine && network != "stagenet" {
		return errors.New("--allow-same-machine is for development on stagenet only")
	}
	if signals := st.SameMachine(ctx, o.Site); len(signals) > 0 {
		if !o.AllowSameMachine {
			return fmt.Errorf("this machine seems to run the site (%s). The wallet host must be a separate machine: run the installer on another Linux machine", strings.Join(signals, "; "))
		}
		tty.Say("Development flag: installing beside the site (%s). Stagenet only.", strings.Join(signals, "; "))
	}

	// Run again: the same address keeps its wallet; another address is refused.
	prev, prevErr := config.Load(p.Config())
	if prevErr == nil && prev.Address != addr {
		return errors.New("this machine already hosts a wallet for another address. Run xmr-bridge uninstall --delete-data first (it deletes the old view-only wallet)")
	}
	if err := checkAdminCopy(p); err != nil {
		return err
	}

	node, err := chooseNode(ctx, o.Node, network, tty, st)
	if err != nil {
		return err
	}
	// A kept wallet keeps its restore height (0 if it wasn't written down); a new one's is chosen after pairing.
	_, walletErr := os.Stat(filepath.Join(p.DataDir(), "wallet", "shop.keys"))
	keepWallet := walletErr == nil
	restore := o.RestoreHeight
	if keepWallet {
		restore = 0
		if prevErr == nil {
			restore = prev.RestoreHeight
		}
	}
	cfg := config.Config{Site: o.Site, Network: config.Network(network), Address: addr, Node: node, DataDir: p.DataDir(),
		RestoreHeight: restore, AutoUpdate: !o.NoAutoUpdate, AllowSameMachine: o.AllowSameMachine}
	if err := cfg.Validate(); err != nil {
		return err
	}

	// From here on the machine changes.
	*changing = true
	uid, gid, err := serviceUser(sys)
	if err != nil {
		return err
	}
	for _, d := range []string{p.DataDir(), p.BinDir(), filepath.Join(p.DataDir(), "run"), filepath.Join(p.DataDir(), "wallet"),
		filepath.Join(p.DataDir(), "ringdb"), filepath.Join(p.DataDir(), "log")} {
		if err := os.MkdirAll(d, 0o700); err != nil {
			return err
		}
	}
	os.Chmod(p.DataDir(), 0o700)
	os.Chmod(p.BinDir(), 0o755)
	if err := copyBinary(o.Exe, p.Binary()); err != nil {
		return fmt.Errorf("installing the bridge binary: %w", err)
	}
	if err := os.WriteFile(p.Guard(), []byte(selfupdate.GuardScript), 0o755); err != nil {
		return fmt.Errorf("installing the update guard: %w", err)
	}
	os.Chmod(p.Guard(), 0o755)
	if err := os.MkdirAll(p.EtcDir(), 0o755); err != nil {
		return err
	}
	// The admin's copy: root-owned, outside anything the service can write.
	if err := os.MkdirAll(filepath.Dir(p.Link()), 0o755); err != nil {
		return err
	}
	if err := copyBinary(o.Exe, p.Link()); err != nil {
		return fmt.Errorf("installing %s: %w", linkPath, err)
	}
	if err := sys.Chown(p.Link(), 0, 0); err != nil {
		return err
	}
	sum, err := fileHash(p.Link())
	if err != nil {
		return err
	}
	if err := os.WriteFile(p.AdminHash(), []byte(sum+"\n"), 0o644); err != nil {
		return err
	}
	if err := config.Save(p.Config(), cfg); err != nil {
		return err
	}
	if err := sys.Chown(p.Config(), uid, gid); err != nil {
		return err
	}
	if _, err := os.Stat(filepath.Join(p.BinDir(), "installed.json")); err != nil {
		tty.Say("Downloading Monero's wallet program and checking its signature…")
		if err := st.InstallWalletRPC(ctx, p.BinDir()); err != nil {
			return err
		}
	}
	if err := sys.Chown(p.DataDir(), uid, gid); err != nil {
		return err
	}
	// Pairing comes before the wallet: the site suggests where a new wallet must start scanning to see payments to
	// the invoices it already watches (spec change 17).
	tty.Say("Pairing with %s…", o.Site)
	suggested, err := st.Pair(ctx, cfg, o.Code)
	if err != nil {
		return err
	}
	if keepWallet {
		tty.Say("Keeping the existing view-only wallet for this address.")
		if w := RestoreHeightWarning(cfg.RestoreHeight, suggested); w != "" {
			tty.Say("%s", w)
		}
	} else {
		switch {
		case cfg.RestoreHeight != 0:
			if w := RestoreHeightWarning(cfg.RestoreHeight, suggested); w != "" {
				tty.Say("%s", w)
			}
		case suggested != 0:
			cfg.RestoreHeight = suggested
			tty.Say("The site has open invoices from about block %d on: the new wallet scans from there.", suggested)
		default:
			info, err := st.NodeInfo(ctx, cfg.Node)
			if err != nil {
				return fmt.Errorf("reading the Monero node's height: %w", err)
			}
			cfg.RestoreHeight = info.Height
		}
		// Written down, so a later run or re-pairing can tell whether this wallet sees the site's invoices.
		if err := config.Save(p.Config(), cfg); err != nil {
			return err
		}
		if err := sys.Chown(p.Config(), uid, gid); err != nil {
			return err
		}
		tty.Say("Creating the view-only wallet (no spend key)…")
		cred := &syscall.Credential{Uid: uint32(uid), Gid: uint32(gid), Groups: []uint32{}}
		if err := st.CreateWallet(ctx, cfg, view, cred); err != nil {
			return fmt.Errorf("%w. The pairing code is used now: press Connect wallet host on the site for a new one before running the installer again", err)
		}
	}
	if err := sys.Chown(p.DataDir(), uid, gid); err != nil {
		return err
	}

	_, unitErr := os.Stat(p.Unit())
	existed := unitErr == nil
	if err := os.MkdirAll(filepath.Dir(p.Unit()), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(p.Unit(), []byte(UnitText()), 0o644); err != nil {
		return err
	}
	if err := sys.Systemctl("daemon-reload"); err != nil {
		return err
	}
	if existed {
		err = sys.Systemctl("restart", ServiceName)
	} else {
		err = sys.Systemctl("enable", "--now", ServiceName)
	}
	if err != nil {
		return err
	}
	tty.Say("Done. The wallet host is installed and paired; the site's Monero payments page shows it as connected.")
	tty.Say("Check it any time with: sudo xmr-bridge status --config %s", configPath)
	tty.Say("What the installer did is in %s.", installLogPath)
	return nil
}

// RestoreHeightWarning is what to tell the admin when a wallet that scans from walletHeight is paired with a site whose
// oldest watched invoice needs scanning from suggested: payments made before walletHeight would be missed. Empty when
// there's nothing to say, including when walletHeight wasn't written down (0).
func RestoreHeightWarning(walletHeight, suggested uint64) string {
	if walletHeight == 0 || suggested == 0 || walletHeight <= suggested {
		return ""
	}
	return fmt.Sprintf("Note: this wallet scans from block %d, but the site has open invoices from about block %d. A payment to one of them made before block %d would be missed. If one doesn't show up, run sudo xmr-bridge uninstall --delete-data and install again without --restore-height.", walletHeight, suggested, walletHeight)
}

// errFatal ends a prompt loop at once (the terminal went away).
type errFatal struct{ error }

// retry runs ask up to three times, saying why each answer was refused.
func retry(tty Prompter, ask func() error) error {
	var last error
	for i := 0; i < tries; i++ {
		err := ask()
		if err == nil {
			return nil
		}
		var fatal errFatal
		if errors.As(err, &fatal) {
			return fatal.error
		}
		last = err
		tty.Say("  %v", err)
	}
	return fmt.Errorf("giving up after %d tries: %w", tries, last)
}

// chooseNode uses --node, else a local monerod on either loopback address, else asks.
func chooseNode(ctx context.Context, flag, network string, tty Prompter, st Steps) (string, error) {
	check := func(u string) error {
		if err := config.CheckNode(u); err != nil {
			return err
		}
		info, err := st.NodeInfo(ctx, u)
		if err != nil {
			return fmt.Errorf("%s doesn't answer as a Monero node", u)
		}
		if info.NetType != network {
			return fmt.Errorf("%s is a %s node, but the shop wallet is on %s", u, info.NetType, network)
		}
		if info.Offline {
			return fmt.Errorf("%s says it is offline", u)
		}
		return nil
	}
	if flag != "" {
		if err := check(flag); err != nil {
			return "", err
		}
		return flag, nil
	}
	port := defaultPorts[network]
	for _, u := range []string{"http://127.0.0.1:" + port, "http://[::1]:" + port} {
		if check(u) == nil {
			tty.Say("Using your own Monero node at %s.", u)
			return u, nil
		}
	}
	tty.Say("No Monero node answers on this machine. Your own node is the most private choice; a remote node you trust works too.")
	var node string
	err := retry(tty, func() error {
		u, err := tty.Ask("Monero node address (for example https://node.example:" + port + "): ")
		if err != nil {
			return errFatal{err}
		}
		u = strings.TrimSpace(u)
		if err := check(u); err != nil {
			return err
		}
		node = u
		return nil
	})
	return node, err
}

func serviceUser(sys System) (int, int, error) {
	uid, gid, ok, err := sys.LookupUser(ServiceUser)
	if err != nil {
		return 0, 0, err
	}
	if !ok {
		if err := sys.AddSystemUser(ServiceUser, dataDir); err != nil {
			return 0, 0, fmt.Errorf("creating the %s user: %w", ServiceUser, err)
		}
		if uid, gid, ok, err = sys.LookupUser(ServiceUser); err != nil || !ok {
			return 0, 0, fmt.Errorf("the %s user wasn't created", ServiceUser)
		}
	}
	return uid, gid, nil
}

// ownAdminCopy reports whether the file at the admin copy's place is this installer's: the admin copy it recorded,
// or the symlink the 3f layout used.
func ownAdminCopy(p Paths) bool {
	fi, err := os.Lstat(p.Link())
	if err != nil {
		return false
	}
	if fi.Mode()&os.ModeSymlink != 0 {
		t, _ := os.Readlink(p.Link())
		return t == binaryPath
	}
	want, err := os.ReadFile(p.AdminHash())
	if err != nil || !fi.Mode().IsRegular() {
		return false
	}
	got, err := fileHash(p.Link())
	return err == nil && got == strings.TrimSpace(string(want))
}

// checkAdminCopy refuses to replace a file at the admin copy's place that isn't this installer's.
func checkAdminCopy(p Paths) error {
	if _, err := os.Lstat(p.Link()); errors.Is(err, os.ErrNotExist) || ownAdminCopy(p) {
		return nil
	}
	return fmt.Errorf("%s already exists and isn't this installer's; move it away and run the installer again", p.Link())
}

func fileHash(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// copyBinary installs the running binary (unless it is already the installed one), mode 755.
func copyBinary(from, to string) error {
	if a, err := os.Stat(from); err == nil {
		if b, err := os.Stat(to); err == nil && os.SameFile(a, b) {
			return nil
		}
	}
	src, err := os.Open(from)
	if err != nil {
		return err
	}
	defer src.Close()
	tmp, err := os.CreateTemp(filepath.Dir(to), ".xmr-bridge-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	defer tmp.Close()
	if _, err := io.Copy(tmp, src); err != nil {
		return err
	}
	if err := tmp.Chmod(0o755); err != nil {
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), to)
}

// Uninstall stops and removes the service and the symlink. The data folder (wallet, key) and the config stay unless
// deleteData is set; then they and the service user go too.
func Uninstall(p Paths, deleteData bool, sys System, out io.Writer) error {
	if sys.Euid() != 0 {
		return errors.New("uninstalling needs root: run it with sudo")
	}
	if err := selfupdate.CheckFormat(p.DataDir()); err != nil {
		return err
	}
	sys.Systemctl("disable", "--now", ServiceName) // not loaded is fine
	if err := os.Remove(p.Unit()); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	sys.Systemctl("daemon-reload")
	if ownAdminCopy(p) {
		os.Remove(p.Link())
	}
	if !deleteData {
		fmt.Fprintf(out, "The service is removed. Kept %s (the view-only wallet and the bridge key) and %s.\n", dataDir, etcDir)
		fmt.Fprintln(out, "To delete them too: xmr-bridge uninstall --delete-data")
		return nil
	}
	for _, d := range []string{p.DataDir(), p.EtcDir()} {
		if err := os.RemoveAll(d); err != nil {
			return err
		}
	}
	if _, _, ok, _ := sys.LookupUser(ServiceUser); ok {
		if err := sys.DeleteUser(ServiceUser); err != nil {
			return err
		}
	}
	fmt.Fprintf(out, "Removed the service, %s, %s and the %s user. The shop wallet itself is untouched: it lives in your wallet app.\n", dataDir, etcDir, ServiceUser)
	return nil
}
