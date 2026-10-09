// Package syncclient sends one signed request to the plugin's bridge/sync route and reads the answer, following the
// wire contract in contract/test-vectors/README.md: JSON body without a byte-order mark, x-xmr-ts and x-xmr-sig
// headers, no Origin or Authorization header, at most 256 KiB (4 KiB when pairing). Errors carry the site's code
// and the fix an admin can act on.
package syncclient

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/sitetext"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/syncsign"
)

const (
	routePath    = "/_emdash/api/plugins/coffer/bridge/sync"
	MaxBody      = 256 << 10
	MaxPairBody  = 4 << 10
	maxResponse  = 1 << 20
	ProtocolV    = 1
	accessFixURL = "/_emdash/api/plugins/coffer/*"
)

// ErrTooLarge: the body is over the plugin's limit; the caller sends fewer snapshots or addresses.
var ErrTooLarge = errors.New("syncclient: request body over the site's limit")

// Body is a bridge/sync request.
type Body struct {
	V         int        `json:"v"`
	Seq       int64      `json:"seq"`
	Height    uint64     `json:"height"`
	Addresses []Address  `json:"addresses"`
	Snapshots []Snapshot `json:"snapshots"`
	Pair      *Pair      `json:"pair,omitempty"`
	// Checks reports the wallet host's checks for the admin page (spec change 13). Optional: the plugin ignores
	// fields it doesn't know, and shows this one from phase 04.
	Checks *Checks `json:"checks,omitempty"`
}

// Checks are the wallet host's health checks.
type Checks struct {
	Node   *Check `json:"node,omitempty"`   // the remote-node cross-check
	Wallet *Check `json:"wallet,omitempty"` // the wallet's height against its node's ("ok", "behind", "unavailable")
}

// Check is one check's state ("off", "ok", "unavailable" or "mismatch") and what it means.
type Check struct {
	State  string `json:"state"`
	Detail string `json:"detail,omitempty"`
}

// Address is a new pool subaddress.
type Address struct {
	Index   uint32 `json:"index"`
	Address string `json:"address"`
}

// Snapshot is every incoming transfer to one watched subaddress (empty when none).
type Snapshot struct {
	Index     uint32     `json:"index"`
	Transfers []Transfer `json:"transfers"`
}

// Transfer is one incoming transfer, with amount and unlock time as decimal strings.
type Transfer struct {
	TxID            string `json:"txid"`
	Amount          string `json:"amount"`
	Confirmations   uint64 `json:"confirmations"`
	Height          uint64 `json:"height"`
	Timestamp       uint64 `json:"timestamp"`
	DoubleSpendSeen bool   `json:"doubleSpendSeen"`
	UnlockTime      string `json:"unlockTime"`
}

// Pair carries the one-time code and the new public key; the request is signed with that key.
type Pair struct {
	Code      string `json:"code"`
	PublicKey string `json:"publicKey"`
}

// Response is a successful sync's answer.
type Response struct {
	PoolFree   int
	PoolTarget int
	// PoolTop is the highest subaddress index the site holds, 0 when the site doesn't say (spec change 15).
	PoolTop uint32
	Watch   []uint32
	// RestoreHeight is the site's suggested restore height for a new wallet, on a pairing response only (spec change
	// 17); 0 when the site doesn't say. A suggestion of 0 reads as 1, so it can never be taken for "today".
	RestoreHeight uint64
}

// Error is a refusal by the site (Code is the plugin's or EmDash's code, or HTTP_<status>) with the fix.
type Error struct {
	Code   string
	Status int
	Hint   string
}

func (e *Error) Error() string {
	if e.Hint == "" {
		return "the site answered " + e.Code
	}
	return "the site answered " + e.Code + ": " + e.Hint
}

func hint(code string) string {
	switch code {
	case "NOT_PAIRED", "BAD_SIGNATURE":
		return "the site doesn't know this wallet host's key. Press " + sitetext.Button + " and run the new command to pair again"
	case "PAIRING_REJECTED", "PAIRING_NOT_ACTIVE":
		return "the pairing code is wrong, used or expired. Press " + sitetext.Button + " again for a new code (valid 15 minutes)"
	case "STALE_TIMESTAMP":
		return "this machine's clock is more than 5 minutes off. Fix the clock (timedatectl set-ntp true)"
	case "UNSUPPORTED_VERSION":
		return "the site's plugin and this bridge don't share a protocol version. Update the older one"
	case "INVALID_BODY", "INVALID_ENCODING":
		return "the site refused the request's contents. This is a bridge bug; the log has details"
	case "INVALID_PLUGIN_REQUEST":
		return "the request was too large for the site"
	case "INVALID_TOKEN":
		return "something in front of the site added an Authorization header. Let " + accessFixURL + " through without a login, and add no Origin or Authorization header"
	case "CSRF_REJECTED":
		return "something in front of the site added an Origin header. Let " + accessFixURL + " through without a login, and add no Origin or Authorization header"
	}
	return ""
}

// Client sends to one site.
type Client struct {
	Site      string // base URL, e.g. https://shop.example
	HTTP      *http.Client
	Now       func() time.Time
	UserAgent string
}

func (c *Client) endpoint() string { return strings.TrimSuffix(c.Site, "/") + routePath }

// Send signs and posts body with key and returns the site's answer.
func (c *Client) Send(ctx context.Context, key ed25519.PrivateKey, body Body) (Response, error) {
	if body.Addresses == nil {
		body.Addresses = []Address{}
	}
	if body.Snapshots == nil {
		body.Snapshots = []Snapshot{}
	}
	for i := range body.Snapshots {
		if body.Snapshots[i].Transfers == nil {
			body.Snapshots[i].Transfers = []Transfer{}
		}
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return Response{}, err
	}
	limit := MaxBody
	if body.Pair != nil {
		limit = MaxPairBody
	}
	if len(raw) > limit {
		return Response{}, ErrTooLarge
	}
	now := time.Now()
	if c.Now != nil {
		now = c.Now()
	}
	ts := strconv.FormatInt(now.Unix(), 10)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint(), bytes.NewReader(raw))
	if err != nil {
		return Response{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-xmr-ts", ts)
	req.Header.Set("x-xmr-sig", syncsign.Sign(key, ts, raw))
	if c.UserAgent != "" {
		req.Header.Set("User-Agent", c.UserAgent)
	}
	hc := http.Client{Timeout: 30 * time.Second}
	if c.HTTP != nil {
		hc = *c.HTTP
	}
	// A redirect is a login page or a misconfigured proxy: report it, don't follow it.
	hc.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	resp, err := hc.Do(req)
	if err != nil {
		return Response{}, fmt.Errorf("syncclient: the site can't be reached: %w", err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxResponse+1))
	if err != nil {
		return Response{}, fmt.Errorf("syncclient: %w", err)
	}
	return parse(resp.StatusCode, data)
}

func parse(status int, data []byte) (Response, error) {
	var env struct {
		Success bool            `json:"success"`
		Data    json.RawMessage `json:"data"`
		Error   *struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	jsonErr := json.Unmarshal(data, &env)
	if status != http.StatusOK {
		code := fmt.Sprintf("HTTP_%d", status)
		if jsonErr == nil && env.Error != nil && env.Error.Code != "" {
			code = env.Error.Code
		}
		h := hint(code)
		if h == "" && (status == http.StatusForbidden || status == http.StatusUnauthorized || (status >= 300 && status < 400)) {
			h = "the site answered with a login page, a redirect or a refusal. Let " + accessFixURL + " through any access rules without a login"
		}
		return Response{}, &Error{Code: code, Status: status, Hint: h}
	}
	bad := &Error{Code: "BAD_RESPONSE", Status: status, Hint: "the site's answer isn't a bridge/sync response. Is the coffer plugin installed on this site?"}
	if jsonErr != nil || !env.Success || len(data) > maxResponse {
		return Response{}, bad
	}
	var d struct {
		OK         bool   `json:"ok"`
		PoolFree   *int   `json:"poolFree"`
		PoolTarget *int   `json:"poolTarget"`
		PoolTop    int64  `json:"poolTop"`
		Watch      []int  `json:"watch"`
		Restore    *int64 `json:"restoreHeight"`
		Error      *struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(env.Data, &d); err != nil {
		return Response{}, bad
	}
	if d.Error != nil {
		return Response{}, &Error{Code: d.Error.Code, Status: status, Hint: hint(d.Error.Code)}
	}
	if !d.OK || d.PoolFree == nil || d.PoolTarget == nil || *d.PoolFree < 0 || *d.PoolTarget < 0 || d.PoolTop < 0 || d.PoolTop > 1<<32-1 || d.Watch == nil || (d.Restore != nil && *d.Restore < 0) {
		return Response{}, bad
	}
	r := Response{PoolFree: *d.PoolFree, PoolTarget: *d.PoolTarget, PoolTop: uint32(d.PoolTop), Watch: make([]uint32, 0, len(d.Watch))}
	if d.Restore != nil {
		r.RestoreHeight = max(uint64(*d.Restore), 1)
	}
	for _, w := range d.Watch {
		if w < 1 || w > 1<<31 {
			return Response{}, bad
		}
		r.Watch = append(r.Watch, uint32(w))
	}
	return r, nil
}
