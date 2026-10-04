// Package hashsig checks Monero's GPG-signed hashes.txt with a deliberately minimal OpenPGP verifier written with
// the Go standard library (spec revision 70, Bridge service, "Decision: how the bridge checks Monero's signed hash
// list"). It accepts exactly one shape: a cleartext-signed message with one "Hash:" header, one v4 RSA signature of
// class 0x01 from the pinned key, SHA-256 or SHA-512. Everything else is refused. The hash list is parsed only from
// the canonical text that was verified.
package hashsig

import (
	"bytes"
	"crypto"
	"crypto/rsa"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"hash"
	"math/big"
	"strings"
	"time"
)

var (
	// ErrUnknownSigner: the signature names a key other than the pinned one. The bridge keeps its current
	// wallet-rpc and asks for a bridge update (a new Monero key arrives that way).
	ErrUnknownSigner = errors.New("hashsig: signed by an unknown key")
	// ErrExpired: the signature carries an expiry time that has passed.
	ErrExpired = errors.New("hashsig: signature expired")
	// ErrBadSignature: well-formed, from the pinned key, but the signature doesn't match the text.
	ErrBadSignature = errors.New("hashsig: bad signature")
)

func malformed(format string, a ...any) error {
	return fmt.Errorf("hashsig: refused: "+format, a...)
}

// maxInput caps the signed file. Monero's hashes.txt is about 3 KB.
const maxInput = 64 << 10

const (
	beginMessage   = "-----BEGIN PGP SIGNED MESSAGE-----"
	beginSignature = "-----BEGIN PGP SIGNATURE-----"
	endSignature   = "-----END PGP SIGNATURE-----"

	hashSHA256 = 8
	hashSHA512 = 10
	algoRSA    = 1
	sigText    = 0x01
	tagSig     = 2
)

// PublicKey is a v4 RSA public key with its fingerprint.
type PublicKey struct {
	Fingerprint [20]byte
	Created     uint32
	Key         *rsa.PublicKey
}

// MoneroReleaseKey is the pinned Monero release key (pinned.go).
var MoneroReleaseKey = mustPinned()

func mustPinned() PublicKey {
	n, err1 := hex.DecodeString(moneroKeyN)
	e, err2 := hex.DecodeString(moneroKeyE)
	if err1 != nil || err2 != nil {
		panic("hashsig: pinned key constants are not hex")
	}
	k, err := NewRSAKey(moneroKeyCreated, n, e)
	if err != nil {
		panic("hashsig: pinned key: " + err.Error())
	}
	if hex.EncodeToString(k.Fingerprint[:]) != moneroKeyFingerprint {
		panic("hashsig: pinned key constants don't match the pinned fingerprint")
	}
	return k
}

// NewRSAKey builds a v4 RSA key from its creation time and the big-endian modulus and exponent, computing its
// fingerprint (SHA-1 over the v4 key packet, as OpenPGP defines it).
func NewRSAKey(created uint32, n, e []byte) (PublicKey, error) {
	nn, ee := new(big.Int).SetBytes(n), new(big.Int).SetBytes(e)
	if nn.BitLen() < 2048 {
		return PublicKey{}, errors.New("RSA modulus under 2048 bits")
	}
	if !ee.IsInt64() || ee.Int64() < 3 || ee.Int64() > 1<<31-1 || ee.Bit(0) == 0 {
		return PublicKey{}, errors.New("unusable RSA exponent")
	}
	body := []byte{4, byte(created >> 24), byte(created >> 16), byte(created >> 8), byte(created), algoRSA}
	body = append(body, mpi(nn)...)
	body = append(body, mpi(ee)...)
	h := sha1.New()
	h.Write([]byte{0x99, byte(len(body) >> 8), byte(len(body))})
	h.Write(body)
	var k PublicKey
	copy(k.Fingerprint[:], h.Sum(nil))
	k.Created = created
	k.Key = &rsa.PublicKey{N: nn, E: int(ee.Int64())}
	return k, nil
}

func mpi(x *big.Int) []byte {
	b := x.Bytes()
	return append([]byte{byte(x.BitLen() >> 8), byte(x.BitLen())}, b...)
}

// Verify checks a cleartext-signed file against key at time now and returns the exact canonical text that was
// verified: dash-escaping undone, trailing spaces and tabs removed from each line, lines joined with CRLF.
func Verify(data []byte, key PublicKey, now time.Time) ([]byte, error) {
	if len(data) > maxInput {
		return nil, malformed("input too large")
	}
	lines, err := splitLines(data)
	if err != nil {
		return nil, err
	}
	if len(lines) == 0 || lines[0] != beginMessage {
		return nil, malformed("does not start with %q", beginMessage)
	}
	i := 1
	hashHeader := ""
	for ; i < len(lines) && lines[i] != ""; i++ {
		v, ok := strings.CutPrefix(lines[i], "Hash: ")
		if !ok || hashHeader != "" {
			return nil, malformed("unexpected armor header")
		}
		hashHeader = v
	}
	if i == len(lines) {
		return nil, malformed("no message body")
	}
	var wantHash byte
	switch hashHeader {
	case "SHA256":
		wantHash = hashSHA256
	case "SHA512":
		wantHash = hashSHA512
	default:
		return nil, malformed("Hash header must be SHA256 or SHA512")
	}
	i++ // the blank line

	var text bytes.Buffer
	first := true
	for ; i < len(lines) && lines[i] != beginSignature; i++ {
		line := lines[i]
		if strings.HasPrefix(line, "-") {
			rest, ok := strings.CutPrefix(line, "- ")
			if !ok {
				return nil, malformed("unescaped dash at the start of a signed line")
			}
			line = rest
		}
		if !first {
			text.WriteString("\r\n")
		}
		first = false
		text.WriteString(strings.TrimRight(line, " \t"))
	}
	if i == len(lines) {
		return nil, malformed("no signature")
	}
	sigPkt, err := decodeArmorLines(lines[i:], "PGP SIGNATURE")
	if err != nil {
		return nil, err
	}
	if err := checkSignature(text.Bytes(), sigPkt, wantHash, key, now); err != nil {
		return nil, err
	}
	return text.Bytes(), nil
}

// splitLines splits on LF, drops one CR before each LF and one final empty line (a trailing newline), and refuses
// control characters other than tab.
func splitLines(data []byte) ([]string, error) {
	for _, c := range data {
		if (c < 0x20 && c != '\t' && c != '\n' && c != '\r') || c == 0x7f {
			return nil, malformed("control character")
		}
	}
	lines := strings.Split(string(data), "\n")
	if lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	for i, l := range lines {
		l = strings.TrimSuffix(l, "\r")
		if strings.ContainsRune(l, '\r') {
			return nil, malformed("stray carriage return")
		}
		lines[i] = l
	}
	return lines, nil
}

// decodeArmor decodes one armored block that is the whole of data (used by tests for key files).
func decodeArmor(data []byte, blockType string) ([]byte, error) {
	lines, err := splitLines(data)
	if err != nil {
		return nil, err
	}
	return decodeArmorLines(lines, blockType)
}

// decodeArmorLines decodes an armored block that must end the input: BEGIN line, no headers, a blank line, base64
// lines, a required "=" checksum line, the END line, nothing after.
func decodeArmorLines(lines []string, blockType string) ([]byte, error) {
	begin, end := "-----BEGIN "+blockType+"-----", "-----END "+blockType+"-----"
	if len(lines) < 4 || lines[0] != begin || lines[1] != "" || lines[len(lines)-1] != end {
		return nil, malformed("bad %s armor", blockType)
	}
	body := lines[2 : len(lines)-1]
	sum := body[len(body)-1]
	body = body[:len(body)-1]
	if len(sum) != 5 || sum[0] != '=' {
		return nil, malformed("missing armor checksum")
	}
	var b64 strings.Builder
	for _, l := range body {
		if l == "" || strings.HasPrefix(l, "=") {
			return nil, malformed("bad armor line")
		}
		b64.WriteString(l)
	}
	raw, err := base64.StdEncoding.Strict().DecodeString(b64.String())
	if err != nil {
		return nil, malformed("bad base64 in armor")
	}
	want, err := base64.StdEncoding.Strict().DecodeString(sum[1:])
	if err != nil || len(want) != 3 {
		return nil, malformed("bad armor checksum")
	}
	c := crc24(raw)
	if want[0] != byte(c>>16) || want[1] != byte(c>>8) || want[2] != byte(c) {
		return nil, malformed("armor checksum mismatch")
	}
	return raw, nil
}

// crc24 is the OpenPGP armor checksum.
func crc24(b []byte) uint32 {
	crc := uint32(0xB704CE)
	for _, c := range b {
		crc ^= uint32(c) << 16
		for i := 0; i < 8; i++ {
			crc <<= 1
			if crc&0x1000000 != 0 {
				crc ^= 0x1864CFB
			}
		}
	}
	return crc & 0xFFFFFF
}

// readPacket reads one packet with a definite length (old or new format; partial lengths refused).
func readPacket(b []byte) (tag byte, body, rest []byte, err error) {
	if len(b) < 2 || b[0]&0x80 == 0 {
		return 0, nil, nil, malformed("bad packet header")
	}
	var n, hl int
	if b[0]&0x40 == 0 { // old format
		tag = (b[0] >> 2) & 0x0f
		switch b[0] & 3 {
		case 0:
			n, hl = int(b[1]), 2
		case 1:
			if len(b) < 3 {
				return 0, nil, nil, malformed("short packet header")
			}
			n, hl = int(binary.BigEndian.Uint16(b[1:3])), 3
		case 2:
			if len(b) < 5 {
				return 0, nil, nil, malformed("short packet header")
			}
			n, hl = int(binary.BigEndian.Uint32(b[1:5])), 5
		default:
			return 0, nil, nil, malformed("indeterminate packet length")
		}
	} else { // new format
		tag = b[0] & 0x3f
		switch o := b[1]; {
		case o < 192:
			n, hl = int(o), 2
		case o < 224:
			if len(b) < 3 {
				return 0, nil, nil, malformed("short packet header")
			}
			n, hl = (int(o)-192)<<8+int(b[2])+192, 3
		case o == 255:
			if len(b) < 6 {
				return 0, nil, nil, malformed("short packet header")
			}
			n, hl = int(binary.BigEndian.Uint32(b[2:6])), 6
		default:
			return 0, nil, nil, malformed("partial packet length")
		}
	}
	if n < 0 || n > len(b)-hl {
		return 0, nil, nil, malformed("packet longer than its data")
	}
	return tag, b[hl : hl+n], b[hl+n:], nil
}

// readMPI reads a minimally encoded multiprecision integer.
func readMPI(b []byte) (val, rest []byte, err error) {
	if len(b) < 2 {
		return nil, nil, malformed("short MPI")
	}
	bits := int(binary.BigEndian.Uint16(b))
	n := (bits + 7) / 8
	if bits == 0 || len(b)-2 < n {
		return nil, nil, malformed("bad MPI length")
	}
	v := b[2 : 2+n]
	if (n-1)*8+bitLen(v[0]) != bits {
		return nil, nil, malformed("non-minimal MPI")
	}
	return v, b[2+n:], nil
}

func bitLen(c byte) int {
	n := 0
	for ; c != 0; c >>= 1 {
		n++
	}
	return n
}

type subpackets struct {
	created, expires uint32
	hasCreated       bool
	hasExpires       bool
	issuerFpr        []byte
	issuerID         []byte
}

// parseSubpackets reads a subpacket area. Hashed: creation time (required, once), signature expiry, issuer
// fingerprint (v4), issuer key ID, each at most once. Unhashed: issuer key ID only. Anything else is refused.
func parseSubpackets(b []byte, hashed bool, s *subpackets) error {
	for len(b) > 0 {
		var n, hl int
		switch o := b[0]; {
		case o < 192:
			n, hl = int(o), 1
		case o < 255:
			if len(b) < 2 {
				return malformed("short subpacket")
			}
			n, hl = (int(o)-192)<<8+int(b[1])+192, 2
		default:
			if len(b) < 5 {
				return malformed("short subpacket")
			}
			n, hl = int(binary.BigEndian.Uint32(b[1:5])), 5
		}
		if n < 1 || n > len(b)-hl {
			return malformed("bad subpacket length")
		}
		typ, data := b[hl]&0x7f, b[hl+1:hl+n]
		b = b[hl+n:]
		switch {
		case typ == 2 && hashed && len(data) == 4 && !s.hasCreated:
			s.created, s.hasCreated = binary.BigEndian.Uint32(data), true
		case typ == 3 && hashed && len(data) == 4 && !s.hasExpires:
			s.expires, s.hasExpires = binary.BigEndian.Uint32(data), true
		case typ == 33 && hashed && len(data) == 21 && data[0] == 4 && s.issuerFpr == nil:
			s.issuerFpr = data[1:]
		case typ == 16 && len(data) == 8 && s.issuerID == nil:
			s.issuerID = data
		default:
			return malformed("unexpected signature subpacket %d", typ)
		}
	}
	return nil
}

func checkSignature(text, pkt []byte, wantHash byte, key PublicKey, now time.Time) error {
	tag, body, rest, err := readPacket(pkt)
	if err != nil {
		return err
	}
	if tag != tagSig || len(rest) != 0 {
		return malformed("expected exactly one signature packet")
	}
	if len(body) < 6 || body[0] != 4 || body[1] != sigText || body[2] != algoRSA {
		return malformed("not a v4 RSA text signature")
	}
	if body[3] != wantHash {
		return malformed("signature hash doesn't match the Hash header")
	}
	hashedLen := int(binary.BigEndian.Uint16(body[4:6]))
	if len(body) < 6+hashedLen+2 {
		return malformed("short signature packet")
	}
	var s subpackets
	if err := parseSubpackets(body[6:6+hashedLen], true, &s); err != nil {
		return err
	}
	p := body[6+hashedLen:]
	unhashedLen := int(binary.BigEndian.Uint16(p[0:2]))
	if len(p) < 2+unhashedLen+2 {
		return malformed("short signature packet")
	}
	if err := parseSubpackets(p[2:2+unhashedLen], false, &s); err != nil {
		return err
	}
	p = p[2+unhashedLen:]
	prefix := p[0:2]
	sigVal, rest, err := readMPI(p[2:])
	if err != nil {
		return err
	}
	if len(rest) != 0 {
		return malformed("data after the signature value")
	}

	if s.issuerFpr == nil && s.issuerID == nil {
		return malformed("signature names no issuer")
	}
	if s.issuerFpr != nil && !bytes.Equal(s.issuerFpr, key.Fingerprint[:]) {
		return ErrUnknownSigner
	}
	if s.issuerID != nil && !bytes.Equal(s.issuerID, key.Fingerprint[12:]) {
		return ErrUnknownSigner
	}
	if !s.hasCreated {
		return malformed("signature has no creation time")
	}
	if s.created < key.Created {
		return malformed("signature is older than its key")
	}
	if int64(s.created) > now.Unix() {
		return malformed("signature is dated in the future")
	}
	if s.hasExpires && s.expires != 0 && now.Unix() >= int64(s.created)+int64(s.expires) {
		return ErrExpired
	}

	var h hash.Hash
	var ch crypto.Hash
	if wantHash == hashSHA256 {
		h, ch = sha256.New(), crypto.SHA256
	} else {
		h, ch = sha512.New(), crypto.SHA512
	}
	h.Write(text)
	h.Write(body[:6+hashedLen])
	var trailer [6]byte
	trailer[0], trailer[1] = 4, 0xff
	binary.BigEndian.PutUint32(trailer[2:], uint32(6+hashedLen))
	h.Write(trailer[:])
	digest := h.Sum(nil)
	if digest[0] != prefix[0] || digest[1] != prefix[1] {
		return ErrBadSignature
	}
	k := (key.Key.N.BitLen() + 7) / 8
	if len(sigVal) > k {
		return ErrBadSignature
	}
	padded := make([]byte, k)
	copy(padded[k-len(sigVal):], sigVal)
	if err := rsa.VerifyPKCS1v15(key.Key, ch, digest, padded); err != nil {
		return ErrBadSignature
	}
	return nil
}
