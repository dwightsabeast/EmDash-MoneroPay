package monerodl

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"runtime"
	"testing"
	"time"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/hashsig"
)

// TestLiveDownload fetches the real hash list and CLI archive from Monero's hosts with the pinned key, installs
// monero-wallet-rpc into XMR_BRIDGE_LIVE_DOWNLOAD (a directory), and, if XMR_BRIDGE_LIVE_COMPARE names a
// monero-wallet-rpc verified by hand, checks the two are identical. Downloads about 85 MB. Skipped by default.
func TestLiveDownload(t *testing.T) {
	dir := os.Getenv("XMR_BRIDGE_LIVE_DOWNLOAD")
	if dir == "" {
		t.Skip("set XMR_BRIDGE_LIVE_DOWNLOAD to a directory to download the real release")
	}
	arch, err := ArchFor(runtime.GOARCH)
	if err != nil {
		t.Fatal(err)
	}
	f := &Fetcher{HashesURL: DefaultHashesURL, ArchiveBase: DefaultArchiveBase, Key: hashsig.MoneroReleaseKey, Arch: arch}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	rel, err := f.Latest(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("verified hash list names %s (%x)", rel.Name, rel.SHA256)
	start := time.Now()
	inst, err := f.Install(ctx, rel, dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("installed %+v in %v", inst, time.Since(start).Round(time.Second))
	if cmp := os.Getenv("XMR_BRIDGE_LIVE_COMPARE"); cmp != "" {
		fh, err := os.Open(cmp)
		if err != nil {
			t.Fatal(err)
		}
		defer fh.Close()
		h := sha256.New()
		io.Copy(h, fh)
		if got := hex.EncodeToString(h.Sum(nil)); got != inst.BinarySHA256 {
			t.Fatalf("%s is %s, the download is %s", cmp, got, inst.BinarySHA256)
		}
		t.Logf("identical to %s", cmp)
	}
}
