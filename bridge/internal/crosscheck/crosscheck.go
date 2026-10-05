// Package crosscheck confirms payments reported through a node that isn't the shop's own against a second node
// before the bridge reports confirmations (spec, Bridge service, duty 6; spec change 13). For each mined transfer it
// asks a second node for the whole block at the transfer's height: that block's hash must equal the configured
// node's, and the txid must be in its transaction list. The second node learns a height, never a txid.
// Confirmations become the smaller of the two nodes' counts. A mismatch holds the transfer at 0 confirmations; no
// second node answering leaves confirmations as they are and reports the check as unavailable.
package crosscheck

import (
	"context"
	"fmt"
	"math/rand/v2"
	"net"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/noderpc"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/walletrpc"
)

// State is the check's outcome for one sync.
type State string

const (
	Off         State = "off"         // the configured node is the shop's own: nothing to check
	OK          State = "ok"          // every mined transfer checked out (or waits for the second node to catch up)
	Unavailable State = "unavailable" // no second node answered: confirmations reported as they are
	Mismatch    State = "mismatch"    // a transfer's block differs on the second node: held at 0 confirmations
)

// Report is what status and the site see.
type Report struct {
	State  State  `json:"state"`
	Detail string `json:"detail,omitempty"`
	Node   string `json:"node,omitempty"` // the second node used (host only)
}

// defaults are public nodes per network (spec change 13, open question 12), checked from the dev box on
// 2026-10-04 (get_info nettype and get_block at height 2221449 agreeing with the local node). Mainnet is chosen
// with Wyatt before release; until then a remote mainnet node gets an "unavailable" check.
var defaults = map[string][]string{
	"stagenet": {
		"https://stagenet.xmr.kernal.eu:38089",
		"http://stagenet.xmr-tw.org:38081",
		"http://node.sethforprivacy.com:38089",
		"http://node.monerodevs.org:38089",
		"http://node2.monerodevs.org:38089",
		"http://xmr-lux.boldsuck.org:38081",
	},
	"mainnet": nil,
	"testnet": nil,
}

// DefaultNodes returns the built-in second nodes for network (nil for an unknown network).
func DefaultNodes(network string) []string {
	l, ok := defaults[network]
	if !ok {
		return nil
	}
	return append([]string{}, l...)
}

// IsOwnNode reports whether nodeURL points at the shop's own node: a loopback, private or link-local address, or
// a host name that resolves only to such addresses.
func IsOwnNode(ctx context.Context, nodeURL string) (bool, error) {
	u, err := url.Parse(nodeURL)
	if err != nil || u.Hostname() == "" {
		return false, fmt.Errorf("crosscheck: not a node URL")
	}
	host := u.Hostname()
	var ips []net.IP
	if ip := net.ParseIP(host); ip != nil {
		ips = []net.IP{ip}
	} else if host == "localhost" {
		return true, nil
	} else {
		rctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		addrs, err := net.DefaultResolver.LookupIPAddr(rctx, host)
		if err != nil || len(addrs) == 0 {
			return false, fmt.Errorf("crosscheck: can't resolve %s", host)
		}
		for _, a := range addrs {
			ips = append(ips, a.IP)
		}
	}
	for _, ip := range ips {
		if !(ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast()) {
			return false, nil
		}
	}
	return true, nil
}

// Checker cross-checks against a list of second nodes. Safe for one caller at a time per sync.
type Checker struct {
	primary string
	network string
	seconds []string
	hc      *http.Client

	mu       sync.Mutex
	verified map[string]bool // txid + "@" + height
}

// New returns a checker for transfers reported through primary.
func New(primary, network string, seconds []string, hc *http.Client) *Checker {
	if hc == nil {
		hc = &http.Client{Timeout: 20 * time.Second}
	}
	return &Checker{primary: primary, network: network, seconds: seconds, hc: hc, verified: map[string]bool{}}
}

// Check returns the transfers with confirmations adjusted, and the outcome.
func (c *Checker) Check(ctx context.Context, ts []walletrpc.Transfer) ([]walletrpc.Transfer, Report) {
	out := append([]walletrpc.Transfer{}, ts...)
	mined := false
	for _, t := range out {
		mined = mined || t.Height > 0
	}
	if !mined {
		return out, Report{State: OK, Detail: "no mined payments to check"}
	}
	second, secondHeight, ok := c.pickSecond(ctx)
	if !ok {
		return out, Report{State: Unavailable, Detail: "no second node answered; confirmations are reported as the configured node gives them"}
	}
	host := hostOf(second)
	rep := Report{State: OK, Node: host}
	primaryHashes := map[uint64]string{}
	for i, t := range out {
		if t.Height == 0 {
			continue
		}
		// The second node's own count; zero while it hasn't reached the block yet.
		var secondConf uint64
		if secondHeight > t.Height {
			secondConf = secondHeight - t.Height
		}
		if secondConf == 0 {
			out[i].Confirmations = 0
			continue
		}
		key := fmt.Sprintf("%s@%d", t.TxID, t.Height)
		c.mu.Lock()
		done := c.verified[key]
		c.mu.Unlock()
		if !done {
			ph, ok := primaryHashes[t.Height]
			if !ok {
				h, err := noderpc.BlockHash(ctx, c.primary, c.hc, t.Height)
				if err != nil {
					return ts, Report{State: Unavailable, Node: host, Detail: "the configured node didn't give the block hash at height " + fmt.Sprint(t.Height)}
				}
				ph, primaryHashes[t.Height] = h, h
			}
			b, err := noderpc.GetBlock(ctx, second, c.hc, t.Height)
			if err != nil {
				return ts, Report{State: Unavailable, Node: host, Detail: fmt.Sprintf("%s didn't give block %d", host, t.Height)}
			}
			switch {
			case b.Hash != ph:
				out[i].Confirmations = 0
				rep = Report{State: Mismatch, Node: host, Detail: fmt.Sprintf("the configured node's block at height %d differs from %s's: payments in it are held at 0 confirmations. Use your own node, or one you trust", t.Height, host)}
				continue
			case !b.Has(t.TxID):
				out[i].Confirmations = 0
				rep = Report{State: Mismatch, Node: host, Detail: fmt.Sprintf("a payment the configured node reports at height %d isn't in that block on %s: it is held at 0 confirmations. Use your own node, or one you trust", t.Height, host)}
				continue
			}
			c.mu.Lock()
			c.verified[key] = true
			c.mu.Unlock()
		}
		out[i].Confirmations = min(t.Confirmations, secondConf)
	}
	return out, rep
}

// pickSecond returns the first second node, in random order, that answers on the right network.
func (c *Checker) pickSecond(ctx context.Context) (string, uint64, bool) {
	order := append([]string{}, c.seconds...)
	rand.Shuffle(len(order), func(i, j int) { order[i], order[j] = order[j], order[i] })
	for _, n := range order {
		ictx, cancel := context.WithTimeout(ctx, 10*time.Second)
		info, err := noderpc.GetInfo(ictx, n, c.hc)
		cancel()
		if err == nil && info.NetType == c.network && !info.Offline && info.Height > 0 {
			return n, info.Height, true
		}
	}
	return "", 0, false
}

func hostOf(nodeURL string) string {
	if u, err := url.Parse(nodeURL); err == nil {
		return u.Host
	}
	return ""
}
