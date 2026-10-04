package pairing

import (
	"context"
	"crypto/ed25519"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/syncclient"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/syncsign"
)

type site struct {
	got  syncclient.Body
	key  ed25519.PrivateKey
	fail error
}

func (s *site) Send(_ context.Context, k ed25519.PrivateKey, b syncclient.Body) (syncclient.Response, error) {
	s.got, s.key = b, k
	if s.fail != nil {
		return syncclient.Response{}, s.fail
	}
	return syncclient.Response{PoolFree: 0, PoolTarget: 50, Watch: []uint32{}}, nil
}

const code = "AbCdEfGhIjKlMnOpQrSt_-"

func TestPair(t *testing.T) {
	s := &site{}
	keyFile := filepath.Join(t.TempDir(), "bridge.key")
	now := time.Unix(1790000000, 0)
	if err := Pair(context.Background(), s, code, keyFile, 2222000, now); err != nil {
		t.Fatal(err)
	}
	if s.got.Pair == nil || s.got.Pair.Code != code || s.got.Pair.PublicKey != syncsign.PublicKeyText(s.key) {
		t.Fatalf("pair field %+v", s.got.Pair)
	}
	if s.got.V != 1 || s.got.Seq != now.UnixMilli() || s.got.Height != 2222000 || len(s.got.Addresses) != 0 || len(s.got.Snapshots) != 0 {
		t.Fatalf("body %+v", s.got)
	}
	saved, err := syncsign.LoadKey(keyFile)
	if err != nil || !saved.Equal(s.key) {
		t.Fatalf("the key that paired wasn't saved: %v", err)
	}
}

func TestFailedPairingKeepsTheOldKey(t *testing.T) {
	keyFile := filepath.Join(t.TempDir(), "bridge.key")
	old, _ := syncsign.NewKey()
	syncsign.SaveKey(keyFile, old)
	s := &site{fail: &syncclient.Error{Code: "PAIRING_REJECTED"}}
	err := Pair(context.Background(), s, code, keyFile, 1, time.Now())
	var e *syncclient.Error
	if !errors.As(err, &e) || e.Code != "PAIRING_REJECTED" {
		t.Fatalf("got %v", err)
	}
	if k, _ := syncsign.LoadKey(keyFile); !k.Equal(old) {
		t.Fatal("a failed pairing replaced the key")
	}
	if s.key.Equal(old) {
		t.Fatal("pairing must use a new key")
	}
}

func TestBadCodeNotSent(t *testing.T) {
	s := &site{}
	for _, c := range []string{"", "short", strings.Repeat("A", 23), strings.Repeat("A", 21) + "!", strings.Repeat("A", 21) + " "} {
		if err := Pair(context.Background(), s, c, filepath.Join(t.TempDir(), "k"), 1, time.Now()); err == nil {
			t.Errorf("%q accepted", c)
		}
	}
	if s.key != nil {
		t.Fatal("a request was sent")
	}
	if _, err := os.Stat(filepath.Join(t.TempDir(), "k")); !os.IsNotExist(err) {
		t.Fatal("a key file appeared")
	}
}

// Once a code is used or expired the site doesn't read the body before the signature, so a pairing request fails
// as NOT_PAIRED or BAD_SIGNATURE (contract/test-vectors/README.md). During pairing that means the code is spent.
func TestSpentCodeMessage(t *testing.T) {
	for _, code := range []string{"BAD_SIGNATURE", "NOT_PAIRED", "PAIRING_REJECTED"} {
		s := &site{fail: &syncclient.Error{Code: code}}
		err := Pair(context.Background(), s, "AbCdEfGhIjKlMnOpQrSt_-", filepath.Join(t.TempDir(), "k"), 1, time.Now())
		var e *syncclient.Error
		if !errors.As(err, &e) || e.Code != code || !strings.Contains(err.Error(), "used or expired") || !strings.Contains(err.Error(), "Connect wallet host") {
			t.Errorf("%s: %v", code, err)
		}
	}
}
