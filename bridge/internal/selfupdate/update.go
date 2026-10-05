package selfupdate

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/monerodl"
)

const (
	maxManifest   = 64 << 10
	maxSignature  = 1 << 10
	maxBinary     = 128 << 20
	bridgeName    = "xmr-bridge"
	healthWindow  = 10 * time.Minute // a bridge update must sync within this (site answering) or roll back
	walletRPCWait = 5 * time.Minute  // a wallet-rpc update must have the wallet open within this
	walletRPCRuns = 3                // or not fail this many times
)

// MoneroSource finds and installs Monero's wallet-rpc (*monerodl.Fetcher).
type MoneroSource interface {
	Latest(ctx context.Context) (monerodl.Release, error)
	Install(ctx context.Context, rel monerodl.Release, dir string) (monerodl.Installed, error)
}

// Updater prepares updates. Prepare* never touch the running files; Apply swaps them in while wallet-rpc is stopped.
type Updater struct {
	BaseURL        string // the bridge release folder: release.json, release.json.sig and the files
	Keys           []ed25519.PublicKey
	Delay          time.Duration // after a bridge release's signed date
	WalletRPCDelay time.Duration // after a wallet-rpc version is first seen (default Delay)
	Current        string        // the running bridge's version
	Arch           string        // "amd64" or "arm64"
	DataDir        string
	HTTP           *http.Client
	Now            func() time.Time
	Monero         MoneroSource
}

// Files is the update state of this data folder.
func (u *Updater) Files() Files { return Files{DataDir: u.DataDir} }

func (u *Updater) now() time.Time {
	if u.Now != nil {
		return u.Now()
	}
	return time.Now()
}

func (u *Updater) bin(name string) string { return filepath.Join(u.DataDir, "bin", name) }

func (u *Updater) get(ctx context.Context, name string, limit int64) ([]byte, error) {
	hc := u.HTTP
	if hc == nil {
		hc = &http.Client{Timeout: 10 * time.Minute}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimSuffix(u.BaseURL, "/")+"/"+name, nil)
	if err != nil {
		return nil, err
	}
	resp, err := hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("selfupdate: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("selfupdate: %s: HTTP %d", name, resp.StatusCode)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(b)) > limit {
		return nil, fmt.Errorf("selfupdate: %s is too large", name)
	}
	return b, nil
}

// Prepared is a verified update waiting to be applied.
type Prepared struct {
	Kind     string
	Version  string
	Previous string
	staged   string // bin/xmr-bridge.new, or the wallet-rpc staging folder
}

// PrepareBridge checks for a newer signed bridge release that has waited out the delay and isn't refused; it
// downloads and checks it into bin/xmr-bridge.new. It returns nil when there is nothing to do.
func (u *Updater) PrepareBridge(ctx context.Context) (*Prepared, error) {
	m, err := u.get(ctx, "release.json", maxManifest)
	if err != nil {
		return nil, err
	}
	sig, err := u.get(ctx, "release.json.sig", maxSignature)
	if err != nil {
		return nil, err
	}
	man, err := VerifyManifest(m, sig, u.Keys)
	if err != nil {
		return nil, err
	}
	if !Newer(man.Version, u.Current) || u.Files().Refused(KindBridge, man.Version) || u.now().Before(man.Date.Add(u.Delay)) {
		return nil, nil
	}
	var file *File
	for i := range man.Files {
		if man.Files[i].OS == "linux" && man.Files[i].Arch == u.Arch {
			file = &man.Files[i]
		}
	}
	if file == nil {
		return nil, fmt.Errorf("selfupdate: release %s has no file for linux/%s", man.Version, u.Arch)
	}
	body, err := u.get(ctx, file.Name, maxBinary)
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(body)
	if int64(len(body)) != file.Size || hex.EncodeToString(sum[:]) != file.SHA256 {
		return nil, fmt.Errorf("selfupdate: %s doesn't match the signed release", file.Name)
	}
	tmp, err := os.CreateTemp(filepath.Join(u.DataDir, "bin"), ".xmr-bridge-*")
	if err != nil {
		return nil, err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(body); err != nil {
		tmp.Close()
		return nil, err
	}
	tmp.Chmod(0o755)
	if err := tmp.Close(); err != nil {
		return nil, err
	}
	// The new program must run here and say it is the version the release names.
	vctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	out, err := exec.CommandContext(vctx, tmp.Name(), "version").Output()
	cancel()
	if f := strings.Fields(string(out)); err != nil || len(f) < 2 || f[0] != bridgeName || f[1] != man.Version {
		return nil, fmt.Errorf("selfupdate: the downloaded %s doesn't run or isn't version %s", bridgeName, man.Version)
	}
	if err := os.Rename(tmp.Name(), u.bin(bridgeName+".new")); err != nil {
		return nil, err
	}
	return &Prepared{Kind: KindBridge, Version: man.Version, Previous: u.Current, staged: u.bin(bridgeName + ".new")}, nil
}

// PrepareWalletRPC checks Monero's release (verified by monerodl) for a version newer than installed that has
// waited out the delay since first seen and isn't refused; it installs it into a staging folder.
func (u *Updater) PrepareWalletRPC(ctx context.Context, installed string) (*Prepared, error) {
	rel, err := u.Monero.Latest(ctx)
	if err != nil {
		return nil, err
	}
	if !Newer(rel.Version, installed) || u.Files().Refused(KindWalletRPC, rel.Version) {
		return nil, nil
	}
	delay := u.WalletRPCDelay
	if delay == 0 {
		delay = u.Delay
	}
	if first := u.Files().FirstSeen(KindWalletRPC, rel.Version, u.now()); u.now().Before(first.Add(delay)) {
		return nil, nil
	}
	staging := u.bin("staging")
	os.RemoveAll(staging)
	if _, err := u.Monero.Install(ctx, rel, staging); err != nil {
		os.RemoveAll(staging)
		return nil, err
	}
	return &Prepared{Kind: KindWalletRPC, Version: rel.Version, Previous: installed, staged: staging}, nil
}

// Apply swaps the update in, keeping the previous files (and, for wallet-rpc, a backup of the wallet files, since a
// new version may upgrade their format), and marks it pending. wallet-rpc must be stopped.
func (p *Prepared) Apply(f Files, now time.Time) error {
	bin := func(n string) string { return filepath.Join(f.DataDir, "bin", n) }
	switch p.Kind {
	case KindBridge:
		if err := os.Rename(bin(bridgeName), bin(bridgeName+".prev")); err != nil {
			return err
		}
		if err := os.Rename(p.staged, bin(bridgeName)); err != nil {
			os.Rename(bin(bridgeName+".prev"), bin(bridgeName))
			return err
		}
	case KindWalletRPC:
		backup := filepath.Join(f.DataDir, "wallet", "backup")
		os.RemoveAll(backup)
		if err := os.MkdirAll(backup, 0o700); err != nil {
			return err
		}
		for _, w := range []string{"shop", "shop.keys"} {
			if err := copyFile(filepath.Join(f.DataDir, "wallet", w), filepath.Join(backup, w)); err != nil {
				return fmt.Errorf("backing up the wallet: %w", err)
			}
		}
		for _, n := range []string{monerodl.BinaryName, "installed.json"} {
			if err := os.Rename(bin(n), bin(n+".prev")); err != nil {
				return err
			}
			if err := os.Rename(filepath.Join(p.staged, n), bin(n)); err != nil {
				return err
			}
		}
		os.RemoveAll(p.staged)
	default:
		return errors.New("selfupdate: unknown update kind")
	}
	return f.SetPending(Pending{Kind: p.Kind, Version: p.Version, Previous: p.Previous, At: now})
}

// Rollback puts the previous files back (as the guard does), refuses the version and ends the pending update.
func Rollback(f Files, p Pending) error {
	bin := func(n string) string { return filepath.Join(f.DataDir, "bin", n) }
	var errs []error
	switch p.Kind {
	case KindBridge:
		errs = append(errs, os.Rename(bin(bridgeName+".prev"), bin(bridgeName)))
	case KindWalletRPC:
		for _, n := range []string{monerodl.BinaryName, "installed.json"} {
			errs = append(errs, os.Rename(bin(n+".prev"), bin(n)))
		}
		for _, w := range []string{"shop", "shop.keys"} {
			errs = append(errs, copyFile(filepath.Join(f.DataDir, "wallet", "backup", w), filepath.Join(f.DataDir, "wallet", w)))
		}
	}
	errs = append(errs, f.Refuse(p.Kind, p.Version))
	f.ClearPending()
	return errors.Join(errs...)
}

func copyFile(from, to string) error {
	b, err := os.ReadFile(from)
	if err != nil {
		return err
	}
	fi, err := os.Stat(from)
	if err != nil {
		return err
	}
	if err := os.WriteFile(to+".tmp", b, fi.Mode().Perm()); err != nil {
		return err
	}
	return os.Rename(to+".tmp", to)
}

// Health is what the running bridge has seen since it started with a pending update.
type Health struct {
	WalletOpen        bool // wallet-rpc ready and the wallet open
	WalletRPCRestarts int
	Synced            int // syncs the site accepted
	SiteRefused       int // syncs the site answered but refused (an error code, or not a sync answer)
	Unreachable       int // syncs that never reached the site (network down, site down)
}

// Action is what to do about a pending update.
type Action int

const (
	Wait Action = iota
	Commit
	RollBack
)

func (a Action) String() string { return [...]string{"wait", "commit", "roll back"}[a] }

// Decide applies the rules (Wyatt, 3g): an accepted sync commits. A bridge update rolls back after 10 minutes only if
// the wallet never opened, or the site answered and refused while nothing was accepted; a site that can't be reached
// is never held against the update. A wallet-rpc update rolls back if it fails 3 times or isn't ready in 5 minutes.
func Decide(p Pending, h Health, now time.Time) Action {
	if h.Synced > 0 {
		return Commit
	}
	elapsed := now.Sub(p.At)
	if p.Kind == KindWalletRPC {
		if h.WalletRPCRestarts >= walletRPCRuns || (!h.WalletOpen && elapsed >= walletRPCWait) {
			return RollBack
		}
		return Wait
	}
	if elapsed < healthWindow {
		return Wait
	}
	if !h.WalletOpen || h.SiteRefused > 0 {
		return RollBack
	}
	return Wait
}
