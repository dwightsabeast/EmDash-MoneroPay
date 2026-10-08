// Package walletrpc is a small JSON-RPC 2.0 client for monero-wallet-rpc, bound to localhost and protected by
// --rpc-login (HTTP digest auth). Only the methods the bridge uses are here. Amounts and unlock times are read as
// uint64 and returned as decimal strings, never through a float.
package walletrpc

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sync"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/secret"
)

// ErrUnauthorized means wallet-rpc refused the login.
var ErrUnauthorized = errors.New("walletrpc: wallet-rpc refused the login")

// RPCError is an error object returned by wallet-rpc.
type RPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (e *RPCError) Error() string {
	return fmt.Sprintf("walletrpc: wallet-rpc error %d: %s", e.Code, e.Message)
}

const (
	rpcPath = "/json_rpc"
	// defaultMaxResponse caps a response body. get_transfers for 100 watched indexes is far below this.
	defaultMaxResponse = 16 << 20
)

// Client talks to one wallet-rpc. It is safe for concurrent use.
type Client struct {
	url         string
	user        string
	pass        secret.String
	http        *http.Client
	maxResponse int64

	mu sync.Mutex
	ch *challenge
	nc uint32
}

// New returns a client for the wallet-rpc at base (for example http://127.0.0.1:38083).
func New(base, user string, pass secret.String, hc *http.Client) *Client {
	if hc == nil {
		hc = &http.Client{}
	}
	return &Client{url: base + rpcPath, user: user, pass: pass, http: hc, maxResponse: defaultMaxResponse}
}

// authHeader returns the Authorization header for the next request, or "" before the first challenge.
func (c *Client) authHeader() (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.ch == nil {
		return "", nil
	}
	c.nc++
	return authorization(*c.ch, c.user, c.pass.Reveal(), http.MethodPost, rpcPath, c.nc)
}

func (c *Client) setChallenge(ch challenge) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.ch, c.nc = &ch, 0
}

// call sends one JSON-RPC request and decodes "result" into out. A 401 is answered once with a fresh challenge,
// and once more only if the server says the nonce was stale; it never loops.
func (c *Client) call(ctx context.Context, method string, params, out any) error {
	body, err := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": "0", "method": method, "params": params})
	if err != nil {
		return err
	}
	for attempt := 0; attempt < 2; attempt++ {
		auth, err := c.authHeader()
		if err != nil {
			return err
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.url, bytes.NewReader(body))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
		if auth != "" {
			req.Header.Set("Authorization", auth)
		}
		resp, err := c.http.Do(req)
		if err != nil {
			return fmt.Errorf("walletrpc: %s: %w", method, err)
		}
		if resp.StatusCode == http.StatusUnauthorized {
			io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
			resp.Body.Close()
			ch, err := pickChallenge(resp.Header.Values("WWW-Authenticate"))
			if err != nil {
				return err
			}
			c.setChallenge(ch)
			if auth != "" && !ch.stale {
				return ErrUnauthorized
			}
			continue
		}
		defer resp.Body.Close()
		return c.decode(resp, method, out)
	}
	return ErrUnauthorized
}

func (c *Client) decode(resp *http.Response, method string, out any) error {
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("walletrpc: %s: HTTP %d", method, resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, c.maxResponse+1))
	if err != nil {
		return fmt.Errorf("walletrpc: %s: %w", method, err)
	}
	if int64(len(data)) > c.maxResponse {
		return fmt.Errorf("walletrpc: %s: response too large", method)
	}
	var env struct {
		Result json.RawMessage `json:"result"`
		Error  *RPCError       `json:"error"`
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	if err := dec.Decode(&env); err != nil {
		return fmt.Errorf("walletrpc: %s: bad response: %w", method, err)
	}
	if _, err := dec.Token(); err != io.EOF {
		return fmt.Errorf("walletrpc: %s: unexpected data after the response", method)
	}
	if env.Error != nil {
		return env.Error
	}
	if len(env.Result) == 0 || string(env.Result) == "null" {
		return fmt.Errorf("walletrpc: %s: response has no result", method)
	}
	if err := json.Unmarshal(env.Result, out); err != nil {
		return fmt.Errorf("walletrpc: %s: bad result: %w", method, err)
	}
	return nil
}

// Version is wallet-rpc's get_version result.
type Version struct {
	Version uint64 `json:"version"`
	Release bool   `json:"release"`
}

// GetVersion returns wallet-rpc's RPC version.
func (c *Client) GetVersion(ctx context.Context) (Version, error) {
	var v Version
	err := c.call(ctx, "get_version", struct{}{}, &v)
	return v, err
}

// GetHeight returns the wallet's synced height.
func (c *Client) GetHeight(ctx context.Context) (uint64, error) {
	var r struct {
		Height uint64 `json:"height"`
	}
	err := c.call(ctx, "get_height", struct{}{}, &r)
	return r.Height, err
}

// NewAddress is a subaddress created in account 0.
type NewAddress struct {
	Index   uint32
	Address string
}

// CreateAddress creates the next subaddress in account 0 with the given label.
func (c *Client) CreateAddress(ctx context.Context, label string) (NewAddress, error) {
	var r struct {
		Address string `json:"address"`
		Index   uint32 `json:"address_index"`
	}
	err := c.call(ctx, "create_address", map[string]any{"account_index": 0, "label": label}, &r)
	return NewAddress{Index: r.Index, Address: r.Address}, err
}

// MaxCreate is the most subaddresses CreateAddresses makes in one call (wallet-rpc itself allows 65536).
const MaxCreate = 1000

// CreateAddresses creates the next n subaddresses in account 0 with the given label, in one call. The result must be
// n consecutive indexes with an address each.
func (c *Client) CreateAddresses(ctx context.Context, label string, n int) ([]NewAddress, error) {
	if n < 1 || n > MaxCreate {
		return nil, fmt.Errorf("walletrpc: create_address: count %d outside 1 to %d", n, MaxCreate)
	}
	var r struct {
		Addresses []string `json:"addresses"`
		Indices   []uint32 `json:"address_indices"`
	}
	if err := c.call(ctx, "create_address", map[string]any{"account_index": 0, "label": label, "count": n}, &r); err != nil {
		return nil, err
	}
	if len(r.Addresses) != n || len(r.Indices) != n {
		return nil, fmt.Errorf("walletrpc: create_address: asked for %d addresses, got %d indexes and %d addresses", n, len(r.Indices), len(r.Addresses))
	}
	out := make([]NewAddress, n)
	for i := range out {
		if r.Addresses[i] == "" || (i > 0 && r.Indices[i] != r.Indices[i-1]+1) {
			return nil, errors.New("walletrpc: create_address: the new addresses aren't consecutive or one is empty")
		}
		out[i] = NewAddress{Index: r.Indices[i], Address: r.Addresses[i]}
	}
	return out, nil
}
