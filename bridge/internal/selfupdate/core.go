// Package selfupdate keeps the wallet host up to date (spec, Bridge service, duty 7; decisions.md, "The bridge's own
// release signatures"; phase 03 session 3g). A bridge release is a release.json signed with Ed25519 over
// SignaturePrefix and its exact bytes, checked against keys pinned in the binary; Monero's wallet-rpc releases are
// checked by internal/monerodl. Updates wait 48 hours, never go backwards, swap files with the previous one kept,
// and roll back when the new one fails; a rolled-back version is refused until a newer one appears.
//
// The state shared with the shell guard (update-guard.sh, run by systemd before each start as the service user) is
// kept in plain files under <dataDir>/run: update-pending, start-count and refused.
package selfupdate

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	KindBridge    = "bridge"
	KindWalletRPC = "wallet-rpc"

	// SignaturePrefix keeps release signatures apart from any other Ed25519 use (sync signatures).
	SignaturePrefix = "xmr-bridge-release-v1\n"

	// StateFormat is the version of the files this build writes in <dataDir>/run. An admin copy of xmr-bridge that
	// finds a newer format refuses to act (see CheckFormat).
	StateFormat = 1
)

// ErrNoKey: this build pins no release key (release builds before phase 09), so automatic updates are off.
var ErrNoKey = errors.New("automatic updates are off: this build has no release key pinned yet")

type version []int

// parseVersion reads "1.2.3" or "0.18.5.1", ignoring a "-suffix".
func parseVersion(s string) (version, error) {
	core, _, _ := strings.Cut(s, "-")
	parts := strings.Split(core, ".")
	if len(parts) < 3 {
		return nil, fmt.Errorf("not a version: %q", s)
	}
	v := make(version, len(parts))
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 || p == "" || strings.TrimLeft(p, "0123456789") != "" {
			return nil, fmt.Errorf("not a version: %q", s)
		}
		v[i] = n
	}
	return v, nil
}

// Newer reports whether a is a strictly newer version than b (an unreadable version is never newer).
func Newer(a, b string) bool {
	va, err1 := parseVersion(a)
	vb, err2 := parseVersion(b)
	if err1 != nil || err2 != nil {
		return false
	}
	for i := 0; i < max(len(va), len(vb)); i++ {
		x, y := 0, 0
		if i < len(va) {
			x = va[i]
		}
		if i < len(vb) {
			y = vb[i]
		}
		if x != y {
			return x > y
		}
	}
	return false
}

// Manifest is a bridge release's release.json.
type Manifest struct {
	Product string    `json:"product"`
	Version string    `json:"version"`
	Date    time.Time `json:"date"`
	Files   []File    `json:"files"`
}

// File is one release file.
type File struct {
	Name   string `json:"name"`
	OS     string `json:"os"`
	Arch   string `json:"arch"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

// VerifyManifest checks sigText (base64) over SignaturePrefix + m against the pinned keys, then reads m.
func VerifyManifest(m, sigText []byte, keys []ed25519.PublicKey) (Manifest, error) {
	if len(keys) == 0 {
		return Manifest{}, ErrNoKey
	}
	sig, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(sigText)))
	if err != nil || len(sig) != ed25519.SignatureSize {
		return Manifest{}, errors.New("the release signature is malformed")
	}
	msg := append([]byte(SignaturePrefix), m...)
	ok := false
	for _, k := range keys {
		ok = ok || (len(k) == ed25519.PublicKeySize && ed25519.Verify(k, msg, sig))
	}
	if !ok {
		return Manifest{}, errors.New("the release isn't signed by a pinned release key")
	}
	var r Manifest
	if err := json.Unmarshal(m, &r); err != nil {
		return Manifest{}, errors.New("the signed release.json can't be read")
	}
	if r.Product != "xmr-bridge" || r.Date.IsZero() || len(r.Files) == 0 {
		return Manifest{}, errors.New("the signed release.json isn't an xmr-bridge release")
	}
	if _, err := parseVersion(r.Version); err != nil {
		return Manifest{}, err
	}
	for _, f := range r.Files {
		if f.Name == "" || strings.ContainsAny(f.Name, "/\\") || strings.HasPrefix(f.Name, ".") || len(f.SHA256) != 64 || f.Size <= 0 {
			return Manifest{}, errors.New("the signed release.json lists a malformed file")
		}
	}
	return r, nil
}

// Pending is an update that has been swapped in but hasn't proven itself yet.
type Pending struct {
	Kind     string
	Version  string
	Previous string
	At       time.Time
}

// Files is the update state under <dataDir>/run.
type Files struct{ DataDir string }

func (f Files) path(name string) string { return filepath.Join(f.DataDir, "run", name) }

func (f Files) write(name, content string) error {
	if err := os.MkdirAll(filepath.Join(f.DataDir, "run"), 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Join(f.DataDir, "run"), ".tmp-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	defer tmp.Close()
	if err := tmp.Chmod(0o600); err != nil {
		return err
	}
	if _, err := tmp.WriteString(content); err != nil {
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), f.path(name))
}

// SetPending records an update that has just been swapped in and resets the start count.
func (f Files) SetPending(p Pending) error {
	if err := f.write("start-count", "0\n"); err != nil {
		return err
	}
	return f.write("update-pending", fmt.Sprintf("kind=%s\nversion=%s\nprevious=%s\nat=%d\n", p.Kind, p.Version, p.Previous, p.At.Unix()))
}

// Pending returns the pending update, if any.
func (f Files) Pending() (Pending, bool) {
	raw, err := os.ReadFile(f.path("update-pending"))
	if err != nil {
		return Pending{}, false
	}
	var p Pending
	for _, line := range strings.Split(string(raw), "\n") {
		k, v, _ := strings.Cut(line, "=")
		switch k {
		case "kind":
			p.Kind = v
		case "version":
			p.Version = v
		case "previous":
			p.Previous = v
		case "at":
			if n, err := strconv.ParseInt(v, 10, 64); err == nil {
				p.At = time.Unix(n, 0).UTC()
			}
		}
	}
	return p, p.Kind != ""
}

// ClearPending ends a pending update (it proved itself, or was rolled back).
func (f Files) ClearPending() {
	os.Remove(f.path("update-pending"))
	os.Remove(f.path("start-count"))
}

// StartCount is how many starts the guard has counted since the last proper start.
func (f Files) StartCount() int {
	raw, _ := os.ReadFile(f.path("start-count"))
	n, _ := strconv.Atoi(strings.TrimSpace(string(raw)))
	return n
}

// MarkStarted records a proper start (wallet-rpc ready, wallet open): earlier failed starts no longer count.
func (f Files) MarkStarted() {
	if _, ok := f.Pending(); ok {
		f.write("start-count", "0\n")
	}
}

// Refuse records a rolled-back version: it, and anything older, is never installed again.
func (f Files) Refuse(kind, v string) error {
	old, _ := os.ReadFile(f.path("refused"))
	return f.write("refused", string(old)+kind+"="+v+"\n")
}

// Refused reports whether v is a refused version, or older than one: only a newer version clears a refusal.
func (f Files) Refused(kind, v string) bool {
	raw, _ := os.ReadFile(f.path("refused"))
	for _, line := range strings.Split(string(raw), "\n") {
		k, r, ok := strings.Cut(line, "=")
		if ok && k == kind && !Newer(v, r) {
			return true
		}
	}
	return false
}

type stateJSON struct {
	Format    int             `json:"format"`
	FirstSeen map[string]seen `json:"firstSeen,omitempty"`
}

type seen struct {
	Version string    `json:"version"`
	At      time.Time `json:"at"`
}

func (f Files) state() stateJSON {
	var s stateJSON
	raw, err := os.ReadFile(f.path("update-state.json"))
	if err == nil {
		json.Unmarshal(raw, &s)
	}
	s.Format = StateFormat
	if s.FirstSeen == nil {
		s.FirstSeen = map[string]seen{}
	}
	return s
}

// FirstSeen returns when version of kind was first seen (now, the first time), for the 48-hour wait on releases
// that carry no signed date (Monero's).
func (f Files) FirstSeen(kind, v string, now time.Time) time.Time {
	s := f.state()
	if prev, ok := s.FirstSeen[kind]; ok && prev.Version == v {
		return prev.At
	}
	s.FirstSeen[kind] = seen{Version: v, At: now.UTC()}
	data, _ := json.Marshal(s)
	f.write("update-state.json", string(data)+"\n")
	return now.UTC()
}

// CheckFormat is for the admin copy of xmr-bridge (status, pair, uninstall): it refuses when the running bridge has
// been updated to a version that writes a state format this copy doesn't know.
func CheckFormat(dataDir string) error {
	raw, err := os.ReadFile(filepath.Join(dataDir, "run", "update-state.json"))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var s stateJSON
	if err := json.Unmarshal(raw, &s); err != nil {
		return fmt.Errorf("can't read %s: %w", filepath.Join(dataDir, "run", "update-state.json"), err)
	}
	if s.Format > StateFormat {
		return fmt.Errorf("the running wallet host was updated to a newer version than this copy of xmr-bridge understands (state format %d, this copy knows %d). Re-run the installer to update this copy: the same install command, with a new code from Connect wallet host", s.Format, StateFormat)
	}
	return nil
}
