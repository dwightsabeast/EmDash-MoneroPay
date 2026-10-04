// Package pairing pairs a wallet host with the site using the admin's one-time code (spec, API contracts,
// "Pairing"): a fresh key, one small request carrying the code and the new public key and signed with that key,
// and the key saved only once the site accepts it. A failed pairing leaves the previous key in place.
package pairing

import (
	"context"
	"crypto/ed25519"
	"errors"
	"fmt"
	"regexp"
	"time"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/syncclient"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/syncsign"
)

// Sender posts one request to the site (*syncclient.Client).
type Sender interface {
	Send(ctx context.Context, key ed25519.PrivateKey, body syncclient.Body) (syncclient.Response, error)
}

var codeRE = regexp.MustCompile(`^[A-Za-z0-9_-]{22}$`)

// ErrBadCode: the code isn't the 22-character form the admin page shows.
var ErrBadCode = errors.New("that isn't a pairing code: copy the 22-character code from the site's Connect wallet host button")

// Pair pairs with code and saves the new key to keyFile. height is the chain height to report (0 if unknown).
func Pair(ctx context.Context, site Sender, code, keyFile string, height uint64, now time.Time) error {
	if !codeRE.MatchString(code) {
		return ErrBadCode
	}
	k, err := syncsign.NewKey()
	if err != nil {
		return err
	}
	body := syncclient.Body{V: syncclient.ProtocolV, Seq: now.UnixMilli(), Height: height,
		Pair: &syncclient.Pair{Code: code, PublicKey: syncsign.PublicKeyText(k)}}
	if _, err := site.Send(ctx, k, body); err != nil {
		return err
	}
	if err := syncsign.SaveKey(keyFile, k); err != nil {
		return fmt.Errorf("paired, but the key couldn't be saved (pair again): %w", err)
	}
	return nil
}
