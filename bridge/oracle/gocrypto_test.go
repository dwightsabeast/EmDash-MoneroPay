package oracle

import (
	"bytes"
	"errors"
	"io"
	"os"
	"time"

	"github.com/ProtonMail/go-crypto/openpgp"
	"github.com/ProtonMail/go-crypto/openpgp/clearsign"
	"github.com/ProtonMail/go-crypto/openpgp/packet"
)

// goCryptoVerdict asks ProtonMail go-crypto the same question as gpgvVerdict: exactly one signature packet, valid
// at `now`, issued by the key's primary key itself (not a subkey); and returns the canonical text it verified.
func goCryptoVerdict(data []byte, keyFile string) verdict {
	f, err := os.Open(keyFile)
	if err != nil {
		return verdict{detail: err.Error()}
	}
	defer f.Close()
	ring, err := openpgp.ReadArmoredKeyRing(f)
	if err != nil || len(ring) != 1 {
		return verdict{detail: "go-crypto: key ring"}
	}
	block, _ := clearsign.Decode(data)
	if block == nil {
		return verdict{detail: "go-crypto: no clearsigned block"}
	}
	sigBytes, err := io.ReadAll(block.ArmoredSignature.Body)
	if err != nil {
		return verdict{detail: "go-crypto: armor: " + err.Error()}
	}
	n, err := countSignatures(sigBytes)
	if err != nil || n != 1 {
		return verdict{detail: "go-crypto: not exactly one signature packet"}
	}
	cfg := &packet.Config{Time: func() time.Time { return now }}
	sig, signer, err := openpgp.VerifyDetachedSignature(ring, bytes.NewReader(block.Bytes), bytes.NewReader(sigBytes), cfg)
	if err != nil {
		return verdict{detail: "go-crypto: " + err.Error()}
	}
	primary := signer.PrimaryKey
	if sig.IssuerFingerprint != nil && !bytes.Equal(sig.IssuerFingerprint, primary.Fingerprint) {
		return verdict{detail: "go-crypto: signed by a subkey"}
	}
	if sig.IssuerKeyId != nil && *sig.IssuerKeyId != primary.KeyId {
		return verdict{detail: "go-crypto: signed by a subkey"}
	}
	return verdict{accepted: true, text: canonical(string(block.Plaintext))}
}

func countSignatures(b []byte) (int, error) {
	r := packet.NewReader(bytes.NewReader(b))
	n := 0
	for {
		p, err := r.Next()
		if errors.Is(err, io.EOF) {
			return n, nil
		}
		if err != nil {
			return n, err
		}
		if _, ok := p.(*packet.Signature); !ok {
			return n, errors.New("not a signature packet")
		}
		n++
	}
}
