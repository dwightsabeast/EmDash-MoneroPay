package walletrpc

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

const txA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const txB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

// Shaped like wallet-rpc 0.18.5.1's get_transfers (spike Q7): numbers for amount and unlock_time, confirmations
// absent in the pool, `locked` present but meaningless to us.
const transfersJSON = `{
  "in": [{"txid":"` + txA + `","amount":18446744073709551615,"confirmations":3,"height":2220700,"timestamp":1790000000,
          "double_spend_seen":false,"unlock_time":0,"locked":true,"type":"in","subaddr_index":{"major":0,"minor":12},
          "subaddr_indices":[{"major":0,"minor":12}],"fee":30000000,"note":"","payment_id":"0000000000000000"}],
  "pool": [{"txid":"` + txB + `","amount":1807305128,"height":0,"timestamp":1790000100,"double_spend_seen":true,
            "unlock_time":18446744073709551615,"locked":true,"type":"pool","subaddr_index":{"major":0,"minor":17}}]
}`

func TestGetTransfers(t *testing.T) {
	f, srv := newFake(t)
	f.results["get_transfers"] = transfersJSON
	got, err := client(f, srv).GetTransfers(context.Background(), []uint32{12, 17})
	if err != nil {
		t.Fatal(err)
	}
	want := []Transfer{
		{TxID: txA, Index: 12, Amount: "18446744073709551615", Confirmations: 3, Height: 2220700, Timestamp: 1790000000, UnlockTime: "0"},
		{TxID: txB, Index: 17, Amount: "1807305128", Height: 0, Timestamp: 1790000100, DoubleSpendSeen: true, UnlockTime: "18446744073709551615", Pool: true},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got  %+v\nwant %+v", got, want)
	}
	var params struct {
		In             bool     `json:"in"`
		Pool           bool     `json:"pool"`
		Out            bool     `json:"out"`
		AccountIndex   *uint32  `json:"account_index"`
		SubaddrIndices []uint32 `json:"subaddr_indices"`
	}
	if err := json.Unmarshal(f.calls[0].Params, &params); err != nil {
		t.Fatal(err)
	}
	if !params.In || !params.Pool || params.Out || params.AccountIndex == nil || *params.AccountIndex != 0 || !reflect.DeepEqual(params.SubaddrIndices, []uint32{12, 17}) {
		t.Fatalf("params = %s", f.calls[0].Params)
	}
}

func TestGetTransfersEmpty(t *testing.T) {
	f, srv := newFake(t)
	f.results["get_transfers"] = `{}`
	got, err := client(f, srv).GetTransfers(context.Background(), []uint32{1})
	if err != nil || len(got) != 0 {
		t.Fatalf("got %v, %v", got, err)
	}
	// No indexes: no call at all (wallet-rpc would return every subaddress).
	got, err = client(f, srv).GetTransfers(context.Background(), nil)
	if err != nil || len(got) != 0 || len(f.calls) != 1 {
		t.Fatalf("empty index list: %v, %v, %d calls", got, err, len(f.calls))
	}
}

func TestGetTransfersRefusesBadValues(t *testing.T) {
	cases := map[string]string{
		"amount over uint64":  strings.Replace(transfersJSON, "18446744073709551615,\"confirmations\"", "18446744073709551616,\"confirmations\"", 1),
		"negative amount":     strings.Replace(transfersJSON, "1807305128", "-1", 1),
		"fractional amount":   strings.Replace(transfersJSON, "1807305128", "1.5", 1),
		"amount as float exp": strings.Replace(transfersJSON, "1807305128", "1.8e9", 1),
		"short txid":          strings.Replace(transfersJSON, txA, "abc", 1),
		"uppercase txid":      strings.Replace(transfersJSON, txA, strings.ToUpper(txA), 1),
		"other account":       strings.Replace(transfersJSON, `{"major":0,"minor":12}`, `{"major":1,"minor":12}`, 1),
		"unrequested index":   strings.Replace(transfersJSON, `"minor":17`, `"minor":99`, 1),
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			f, srv := newFake(t)
			f.results["get_transfers"] = body
			if _, err := client(f, srv).GetTransfers(context.Background(), []uint32{12, 17}); err == nil {
				t.Fatal("accepted")
			}
		})
	}
}
