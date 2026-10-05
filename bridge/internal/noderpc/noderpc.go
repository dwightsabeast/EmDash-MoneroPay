// Package noderpc asks a monerod for the few facts the bridge needs: its network and height (get_info, for the
// restore height and the network check) and, for the remote-node cross-check (spec change 13), a block's hash and
// transaction list at a height. Nodes may be remote and untrusted: responses are size-capped and checked, and
// nothing here trusts an answer beyond the fields it reads.
package noderpc

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	maxInfoResponse  = 1 << 20
	maxBlockResponse = 4 << 20
)

// Info is the part of get_info the bridge uses.
type Info struct {
	NetType      string // "mainnet", "stagenet" or "testnet"
	Height       uint64 // block count (top block height + 1)
	Synchronized bool
	Offline      bool
	Version      string
}

// RPCError is an error object returned by the node.
type RPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (e *RPCError) Error() string {
	return fmt.Sprintf("noderpc: node error %d: %s", e.Code, e.Message)
}

// call posts one JSON-RPC request to nodeURL/json_rpc and decodes "result" into out.
func call(ctx context.Context, nodeURL string, hc *http.Client, method string, params any, limit int, out any) error {
	u, err := url.Parse(nodeURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return errors.New("noderpc: node must be an http or https URL")
	}
	if hc == nil {
		hc = &http.Client{Timeout: 30 * time.Second}
	}
	req := map[string]any{"jsonrpc": "2.0", "id": "0", "method": method}
	if params != nil {
		req["params"] = params
	}
	body, _ := json.Marshal(req)
	hreq, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimSuffix(nodeURL, "/")+"/json_rpc", bytes.NewReader(body))
	if err != nil {
		return err
	}
	hreq.Header.Set("Content-Type", "application/json")
	resp, err := hc.Do(hreq)
	if err != nil {
		return fmt.Errorf("noderpc: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("noderpc: %s: HTTP %d", method, resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, int64(limit)+1))
	if err != nil {
		return fmt.Errorf("noderpc: %w", err)
	}
	if len(data) > limit {
		return fmt.Errorf("noderpc: %s: response too large", method)
	}
	var env struct {
		Result json.RawMessage `json:"result"`
		Error  *RPCError       `json:"error"`
	}
	if err := json.Unmarshal(data, &env); err != nil {
		return fmt.Errorf("noderpc: %s: not a JSON-RPC response", method)
	}
	if env.Error != nil {
		return env.Error
	}
	if len(env.Result) == 0 || string(env.Result) == "null" {
		return fmt.Errorf("noderpc: %s: no result", method)
	}
	if err := json.Unmarshal(env.Result, out); err != nil {
		return fmt.Errorf("noderpc: %s: bad result", method)
	}
	return nil
}

// GetInfo calls get_info on the node at nodeURL (http or https).
func GetInfo(ctx context.Context, nodeURL string, hc *http.Client) (Info, error) {
	var r struct {
		NetType      string `json:"nettype"`
		Height       uint64 `json:"height"`
		Synchronized bool   `json:"synchronized"`
		Offline      bool   `json:"offline"`
		Version      string `json:"version"`
		Status       string `json:"status"`
	}
	if err := call(ctx, nodeURL, hc, "get_info", nil, maxInfoResponse, &r); err != nil {
		return Info{}, err
	}
	if r.Status != "OK" {
		return Info{}, errors.New("noderpc: get_info: the node did not answer OK")
	}
	switch r.NetType {
	case "mainnet", "stagenet", "testnet":
	default:
		return Info{}, errors.New("noderpc: get_info: the node did not say which network it is on")
	}
	return Info{NetType: r.NetType, Height: r.Height, Synchronized: r.Synchronized, Offline: r.Offline, Version: r.Version}, nil
}

type header struct {
	Hash   string `json:"hash"`
	Height uint64 `json:"height"`
}

func checkHeader(h header, height uint64) error {
	if !isHash(h.Hash) || h.Height != height {
		return errors.New("noderpc: the node answered for a different block, or with a malformed hash")
	}
	return nil
}

// BlockHash returns the hash of the block at height (get_block_header_by_height).
func BlockHash(ctx context.Context, nodeURL string, hc *http.Client, height uint64) (string, error) {
	var r struct {
		Status string `json:"status"`
		Header header `json:"block_header"`
	}
	if err := call(ctx, nodeURL, hc, "get_block_header_by_height", map[string]any{"height": height}, maxInfoResponse, &r); err != nil {
		return "", err
	}
	if r.Status != "OK" {
		return "", errors.New("noderpc: get_block_header_by_height: the node did not answer OK")
	}
	if err := checkHeader(r.Header, height); err != nil {
		return "", err
	}
	return r.Header.Hash, nil
}

// Block is a block's hash and the hashes of the transactions it contains (not the miner transaction).
type Block struct {
	Height   uint64
	Hash     string
	TxHashes []string
}

// Has reports whether txid is in the block.
func (b Block) Has(txid string) bool {
	for _, h := range b.TxHashes {
		if h == txid {
			return true
		}
	}
	return false
}

// GetBlock returns the block at height (get_block).
func GetBlock(ctx context.Context, nodeURL string, hc *http.Client, height uint64) (Block, error) {
	var r struct {
		Status   string   `json:"status"`
		Header   header   `json:"block_header"`
		TxHashes []string `json:"tx_hashes"`
	}
	if err := call(ctx, nodeURL, hc, "get_block", map[string]any{"height": height}, maxBlockResponse, &r); err != nil {
		return Block{}, err
	}
	if r.Status != "OK" {
		return Block{}, errors.New("noderpc: get_block: the node did not answer OK")
	}
	if err := checkHeader(r.Header, height); err != nil {
		return Block{}, err
	}
	for _, h := range r.TxHashes {
		if !isHash(h) {
			return Block{}, errors.New("noderpc: get_block: malformed transaction hash")
		}
	}
	return Block{Height: height, Hash: r.Header.Hash, TxHashes: r.TxHashes}, nil
}

// isHash reports whether s is 64 lowercase hex characters.
func isHash(s string) bool {
	if len(s) != 64 {
		return false
	}
	for i := 0; i < len(s); i++ {
		if !('0' <= s[i] && s[i] <= '9' || 'a' <= s[i] && s[i] <= 'f') {
			return false
		}
	}
	return true
}
