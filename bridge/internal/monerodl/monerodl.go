// Package monerodl downloads Monero's monero-wallet-rpc and installs it only after it checks out: the GPG-signed
// hashes.txt is verified with internal/hashsig against the pinned Monero key, the release archive's SHA-256 must
// match the verified list, and only the monero-wallet-rpc entry is extracted (spec, Bridge service, duty 1).
package monerodl

import (
	"archive/tar"
	"bytes"
	"compress/bzip2"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/hashsig"
)

const (
	// The two download hosts are fixed (Wyatt, 3b-2 plan): the signed hash list and the CLI archives.
	DefaultHashesURL   = "https://www.getmonero.org/downloads/hashes.txt"
	DefaultArchiveBase = "https://downloads.getmonero.org/cli/"

	// BinaryName is the one file taken from the archive, and its name in the install directory.
	BinaryName    = "monero-wallet-rpc"
	installedFile = "installed.json"

	maxHashes         = 64 << 10
	defaultMaxArchive = 256 << 20 // linux-x64 0.18.5.1 is 85 MB
	defaultMaxBinary  = 128 << 20 // monero-wallet-rpc 0.18.5.1 is 29 MB
	maxUnpacked       = 2 << 30   // bounds the decompressed stream (a bzip2 bomb)
	hashesTimeout     = 30 * time.Second
)

// Fetcher downloads and installs monero-wallet-rpc. Zero values take the defaults.
type Fetcher struct {
	HashesURL   string
	ArchiveBase string
	Key         hashsig.PublicKey
	Arch        string // "x64" or "armv8" (ArchFor)
	HTTP        *http.Client
	Now         func() time.Time
	MaxArchive  int64
	MaxBinary   int64
}

// ArchFor maps Go's architecture name to the one in Monero's release file names.
func ArchFor(goarch string) (string, error) {
	switch goarch {
	case "amd64":
		return "x64", nil
	case "arm64":
		return "armv8", nil
	}
	return "", fmt.Errorf("monerodl: no Monero CLI release for %q (linux amd64 and arm64 only)", goarch)
}

// Release is the CLI archive the verified hash list names for this CPU.
type Release struct {
	Name    string
	Version string
	SHA256  [32]byte
}

// Installed describes the installed monero-wallet-rpc (installed.json beside it).
type Installed struct {
	Version       string `json:"version"`
	Archive       string `json:"archive"`
	ArchiveSHA256 string `json:"archiveSha256"`
	BinarySHA256  string `json:"binarySha256"`
}

func (f *Fetcher) now() time.Time {
	if f.Now != nil {
		return f.Now()
	}
	return time.Now()
}

func orDefault(v, d int64) int64 {
	if v > 0 {
		return v
	}
	return d
}

// client returns an HTTP client that follows redirects only over https and only within the configured hosts.
func (f *Fetcher) client() (*http.Client, error) {
	allowed := map[string]bool{}
	for _, raw := range []string{f.HashesURL, f.ArchiveBase} {
		u, err := url.Parse(raw)
		if err != nil || u.Scheme != "https" || u.Host == "" {
			return nil, fmt.Errorf("monerodl: download addresses must be https URLs")
		}
		allowed[u.Host] = true
	}
	c := http.Client{Timeout: 15 * time.Minute}
	if f.HTTP != nil {
		c = *f.HTTP
	}
	c.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("monerodl: too many redirects")
		}
		if req.URL.Scheme != "https" || !allowed[req.URL.Host] {
			return fmt.Errorf("monerodl: refused a redirect to %s", req.URL.Host)
		}
		return nil
	}
	return &c, nil
}

// get copies the body of an https GET into w, refusing more than limit bytes.
func get(ctx context.Context, c *http.Client, rawURL string, limit int64, w io.Writer) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return err
	}
	resp, err := c.Do(req)
	if err != nil {
		return fmt.Errorf("monerodl: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("monerodl: %s: HTTP %d", req.URL.Path, resp.StatusCode)
	}
	n, err := io.Copy(w, io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return fmt.Errorf("monerodl: %s: %w", req.URL.Path, err)
	}
	if n > limit {
		return fmt.Errorf("monerodl: %s: larger than %d bytes", req.URL.Path, limit)
	}
	return nil
}

// Latest fetches and verifies the hash list and returns the single CLI release for this CPU.
func (f *Fetcher) Latest(ctx context.Context) (Release, error) {
	c, err := f.client()
	if err != nil {
		return Release{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, hashesTimeout)
	defer cancel()
	var buf bytes.Buffer
	if err := get(ctx, c, f.HashesURL, maxHashes, &buf); err != nil {
		return Release{}, err
	}
	text, err := hashsig.Verify(buf.Bytes(), f.Key, f.now())
	if err != nil {
		return Release{}, fmt.Errorf("monerodl: hash list: %w", err)
	}
	hashes, err := hashsig.ParseHashes(text)
	if err != nil {
		return Release{}, fmt.Errorf("monerodl: hash list: %w", err)
	}
	re, err := regexp.Compile(`^monero-linux-` + regexp.QuoteMeta(f.Arch) + `-v([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)\.tar\.bz2$`)
	if err != nil || f.Arch == "" {
		return Release{}, errors.New("monerodl: no CPU architecture set")
	}
	var rel Release
	found := 0
	for name, sum := range hashes {
		if m := re.FindStringSubmatch(name); m != nil {
			rel, found = Release{Name: name, Version: m[1], SHA256: sum}, found+1
		}
	}
	if found != 1 {
		return Release{}, fmt.Errorf("monerodl: the hash list names %d CLI releases for linux-%s, want exactly 1", found, f.Arch)
	}
	return rel, nil
}

// Install downloads rel, checks its SHA-256 against the verified list, extracts monero-wallet-rpc into binDir
// and records it. Nothing in binDir changes unless every check passes; a failure leaves the previous install.
func (f *Fetcher) Install(ctx context.Context, rel Release, binDir string) (Installed, error) {
	c, err := f.client()
	if err != nil {
		return Installed{}, err
	}
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		return Installed{}, fmt.Errorf("monerodl: %w", err)
	}
	archive, err := os.CreateTemp(binDir, ".archive-*")
	if err != nil {
		return Installed{}, fmt.Errorf("monerodl: %w", err)
	}
	defer os.Remove(archive.Name())
	defer archive.Close()

	h := sha256.New()
	if err := get(ctx, c, f.ArchiveBase+rel.Name, orDefault(f.MaxArchive, defaultMaxArchive), io.MultiWriter(archive, h)); err != nil {
		return Installed{}, err
	}
	var got [32]byte
	copy(got[:], h.Sum(nil))
	if got != rel.SHA256 {
		return Installed{}, fmt.Errorf("monerodl: %s does not match the signed hash list", rel.Name)
	}
	if _, err := archive.Seek(0, io.SeekStart); err != nil {
		return Installed{}, fmt.Errorf("monerodl: %w", err)
	}

	bin, err := os.CreateTemp(binDir, ".wallet-rpc-*")
	if err != nil {
		return Installed{}, fmt.Errorf("monerodl: %w", err)
	}
	defer os.Remove(bin.Name()) // no-op after the rename
	defer bin.Close()
	binSum, err := extract(archive, bin, orDefault(f.MaxBinary, defaultMaxBinary))
	if err != nil {
		return Installed{}, err
	}
	if err := bin.Chmod(0o755); err != nil {
		return Installed{}, fmt.Errorf("monerodl: %w", err)
	}
	if err := bin.Sync(); err != nil {
		return Installed{}, fmt.Errorf("monerodl: %w", err)
	}

	inst := Installed{
		Version:       rel.Version,
		Archive:       rel.Name,
		ArchiveSHA256: hex.EncodeToString(got[:]),
		BinarySHA256:  hex.EncodeToString(binSum[:]),
	}
	record, err := os.CreateTemp(binDir, ".installed-*")
	if err != nil {
		return Installed{}, fmt.Errorf("monerodl: %w", err)
	}
	defer os.Remove(record.Name())
	defer record.Close()
	data, _ := json.MarshalIndent(inst, "", "  ")
	if _, err := record.Write(append(data, '\n')); err != nil {
		return Installed{}, fmt.Errorf("monerodl: %w", err)
	}
	if err := record.Chmod(0o644); err != nil {
		return Installed{}, fmt.Errorf("monerodl: %w", err)
	}
	if err := record.Sync(); err != nil {
		return Installed{}, fmt.Errorf("monerodl: %w", err)
	}
	if err := os.Rename(bin.Name(), filepath.Join(binDir, BinaryName)); err != nil {
		return Installed{}, fmt.Errorf("monerodl: %w", err)
	}
	if err := os.Rename(record.Name(), filepath.Join(binDir, installedFile)); err != nil {
		return Installed{}, fmt.Errorf("monerodl: %w", err)
	}
	return inst, nil
}

// extract copies the archive's single "<dir>/monero-wallet-rpc" regular file into w and returns its SHA-256.
// A link, a second entry with that name, an entry at another depth or one over maxBinary is refused.
func extract(archive io.Reader, w io.Writer, maxBinary int64) ([32]byte, error) {
	var sum [32]byte
	tr := tar.NewReader(io.LimitReader(bzip2.NewReader(archive), maxUnpacked))
	found := false
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return sum, fmt.Errorf("monerodl: archive: %w", err)
		}
		if path.Base(hdr.Name) != BinaryName {
			continue
		}
		if found {
			return sum, errors.New("monerodl: archive has more than one " + BinaryName)
		}
		found = true
		clean := path.Clean(hdr.Name)
		if dir := path.Dir(clean); clean != hdr.Name || dir == "." || strings.Contains(dir, "/") || strings.HasPrefix(dir, ".") {
			return sum, fmt.Errorf("monerodl: archive: unexpected path %q", hdr.Name)
		}
		if hdr.Typeflag != tar.TypeReg {
			return sum, errors.New("monerodl: archive: " + BinaryName + " is not a regular file")
		}
		if hdr.Size > maxBinary {
			return sum, errors.New("monerodl: archive: " + BinaryName + " is too large")
		}
		h := sha256.New()
		n, err := io.Copy(io.MultiWriter(w, h), io.LimitReader(tr, maxBinary+1))
		if err != nil {
			return sum, fmt.Errorf("monerodl: archive: %w", err)
		}
		if n > maxBinary || n != hdr.Size {
			return sum, errors.New("monerodl: archive: " + BinaryName + " has the wrong size")
		}
		copy(sum[:], h.Sum(nil))
	}
	if !found {
		return sum, errors.New("monerodl: archive has no " + BinaryName)
	}
	return sum, nil
}

// ReadInstalled reads the record of the installed monero-wallet-rpc in binDir.
func ReadInstalled(binDir string) (Installed, error) {
	data, err := os.ReadFile(filepath.Join(binDir, installedFile))
	if err != nil {
		return Installed{}, fmt.Errorf("monerodl: %w", err)
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	var inst Installed
	if err := dec.Decode(&inst); err != nil {
		return Installed{}, fmt.Errorf("monerodl: %s: %w", installedFile, err)
	}
	return inst, nil
}
