// Package noderpc asks the configured monerod for its network and height (get_info), so the bridge can refuse a
// node of the wrong network and pick a restore height. The node may be remote and untrusted: responses are
// size-capped and checked, and nothing here trusts its answer beyond those two facts.
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

const maxResponse = 1 << 20

// Info is the part of get_info the bridge uses.
type Info struct {
	NetType      string // "mainnet", "stagenet" or "testnet"
	Height       uint64
	Synchronized bool
	Offline      bool
	Version      string
}

// GetInfo calls get_info on the node at nodeURL (http or https).
func GetInfo(ctx context.Context, nodeURL string, hc *http.Client) (Info, error) {
	u, err := url.Parse(nodeURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return Info{}, errors.New("noderpc: node must be an http or https URL")
	}
	if hc == nil {
		hc = &http.Client{Timeout: 30 * time.Second}
	}
	body := []byte(`{"jsonrpc":"2.0","id":"0","method":"get_info"}`)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimSuffix(nodeURL, "/")+"/json_rpc", bytes.NewReader(body))
	if err != nil {
		return Info{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := hc.Do(req)
	if err != nil {
		return Info{}, fmt.Errorf("noderpc: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Info{}, fmt.Errorf("noderpc: get_info: HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxResponse+1))
	if err != nil {
		return Info{}, fmt.Errorf("noderpc: %w", err)
	}
	if len(data) > maxResponse {
		return Info{}, errors.New("noderpc: get_info: response too large")
	}
	var env struct {
		Result *struct {
			NetType      string `json:"nettype"`
			Height       uint64 `json:"height"`
			Synchronized bool   `json:"synchronized"`
			Offline      bool   `json:"offline"`
			Version      string `json:"version"`
			Status       string `json:"status"`
		} `json:"result"`
		Error *struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(data, &env); err != nil {
		return Info{}, errors.New("noderpc: get_info: not a JSON-RPC response")
	}
	if env.Error != nil {
		return Info{}, fmt.Errorf("noderpc: get_info: node error %d: %s", env.Error.Code, env.Error.Message)
	}
	r := env.Result
	if r == nil || r.Status != "OK" {
		return Info{}, errors.New("noderpc: get_info: the node did not answer OK")
	}
	switch r.NetType {
	case "mainnet", "stagenet", "testnet":
	default:
		return Info{}, errors.New("noderpc: get_info: the node did not say which network it is on")
	}
	return Info{NetType: r.NetType, Height: r.Height, Synchronized: r.Synchronized, Offline: r.Offline, Version: r.Version}, nil
}
