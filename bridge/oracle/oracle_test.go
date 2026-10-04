// Package oracle runs the bridge's hash-list verifier and independent OpenPGP implementations over the same inputs
// and compares their verdicts (spec revision 70: "Differential oracles in CI only"). It is a separate module so
// nothing here can reach the shipped bridge. Needs gpg and gpgv on PATH.
package oracle

import (
	"bufio"
	"bytes"
	"encoding/hex"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/hashsig"
)

const testdata = "../internal/hashsig/testdata"

// now matches the hashsig tests: after every test signature, before the 50-year expiry.
var now = time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC)

// Verdict: accepted means "one valid signature by the pinned primary key over this text, unexpired".
type verdict struct {
	accepted bool
	text     string // canonical text when accepted (lines trimmed of trailing spaces and tabs, joined with CRLF)
	detail   string
}

// signer is a key both sides can use: our PublicKey and a gpgv keyring file.
type signer struct {
	name    string
	key     hashsig.PublicKey
	keyring string
}

func gpgHome(t *testing.T) string {
	t.Helper()
	d := t.TempDir()
	os.Chmod(d, 0o700)
	return d
}

// loadSigner dearmors an armored public key for gpgv and reads its primary modulus and exponent with
// `gpg --show-keys --with-key-data` (no import), building our key from them.
func loadSigner(t *testing.T, name, file string) signer {
	t.Helper()
	home := gpgHome(t)
	ring := filepath.Join(t.TempDir(), name+".gpg")
	if out, err := exec.Command("gpg", "--batch", "--homedir", home, "--dearmor", "-o", ring, file).CombinedOutput(); err != nil {
		t.Fatalf("dearmor %s: %v %s", file, err, out)
	}
	out, err := exec.Command("gpg", "--batch", "--homedir", home, "--show-keys", "--with-colons", "--with-key-data", file).Output()
	if err != nil {
		t.Fatalf("show-keys %s: %v", file, err)
	}
	var created uint32
	var n, e []byte
	primary := false
	for _, line := range strings.Split(string(out), "\n") {
		f := strings.Split(line, ":")
		switch {
		case f[0] == "pub":
			primary = true
			var c uint64
			for _, ch := range f[5] {
				c = c*10 + uint64(ch-'0')
			}
			created = uint32(c)
		case f[0] == "sub":
			primary = false
		case f[0] == "pkd" && primary && len(f) > 3:
			v, err := hex.DecodeString(f[3])
			if err != nil {
				t.Fatal(err)
			}
			if f[1] == "0" {
				n = v
			} else if f[1] == "1" {
				e = v
			}
		}
	}
	k, err := hashsig.NewRSAKey(created, n, e)
	if err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	return signer{name: name, key: k, keyring: ring}
}

func canonical(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.TrimSuffix(s, "\n")
	lines := strings.Split(s, "\n")
	for i, l := range lines {
		lines[i] = strings.TrimRight(l, " \t")
	}
	return strings.Join(lines, "\r\n")
}

func ours(data []byte, s signer) verdict {
	text, err := hashsig.Verify(data, s.key, now)
	if err != nil {
		return verdict{detail: err.Error()}
	}
	return verdict{accepted: true, text: string(text)}
}

// gpgvVerdict maps gpgv's machine-readable status to the same question: exit 0, exactly one VALIDSIG whose
// signing key is the pinned primary key itself, and no bad, error or expired signature lines.
func gpgvVerdict(t *testing.T, data []byte, s signer) verdict {
	dir := t.TempDir()
	in, out := filepath.Join(dir, "in.txt"), filepath.Join(dir, "out.txt")
	os.WriteFile(in, data, 0o600)
	cmd := exec.Command("gpgv", "--keyring", s.keyring, "--status-fd", "1", "--output", out, in)
	cmd.Env = append(os.Environ(), "GNUPGHOME="+gpgHome(t), "TZ=UTC")
	status, err := cmd.Output()
	primary := strings.ToUpper(hex.EncodeToString(s.key.Fingerprint[:]))
	valid, bad := 0, []string{}
	sc := bufio.NewScanner(bytes.NewReader(status))
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) < 2 || f[0] != "[GNUPG:]" {
			continue
		}
		switch f[1] {
		case "VALIDSIG":
			// VALIDSIG <signing fpr> <date> <ts> <expire> <ver> <reserved> <pk algo> <hash algo> <class> <primary fpr>
			if len(f) >= 12 && f[2] == primary && f[11] == primary {
				valid++
			} else {
				bad = append(bad, "VALIDSIG by "+f[2])
			}
		case "BADSIG", "ERRSIG", "EXPSIG", "EXPKEYSIG", "REVKEYSIG", "NO_PUBKEY", "NODATA", "BADARMOR":
			bad = append(bad, f[1])
		}
	}
	if err != nil || valid != 1 || len(bad) > 0 {
		return verdict{detail: strings.TrimSpace("gpgv: " + strings.Join(bad, " ") + " exit " + exitText(err))}
	}
	text, rerr := os.ReadFile(out)
	if rerr != nil {
		t.Fatal(rerr)
	}
	return verdict{accepted: true, text: canonical(string(text))}
}

func exitText(err error) string {
	if err == nil {
		return "0"
	}
	if ee, ok := err.(*exec.ExitError); ok {
		return strings.TrimPrefix(ee.ProcessState.String(), "exit status ")
	}
	return err.Error()
}

// expectedDifferences lists inputs where our verifier refuses by policy something an oracle accepts. Each entry
// names the policy. Nothing else may differ.
// Our verifier never accepts what an oracle refuses, and accepted texts always match; see spec change 10.
var expectedDifferences = map[string]string{
	"bad-sha384.txt/A":              "hash algorithms limited to SHA-256 and SHA-512 (spec revision 70)",
	"real: text before/monero":      "text outside the signed block refused (spec revision 70)",
	"real: text after/monero":       "text outside the signed block refused (spec revision 70)",
	"real: checksum removed/monero": "armor checksum required (spec change 10, proposed)",
	"real: armor header/monero":     "no armor headers in the signature block (spec change 10, proposed)",
}

type input struct {
	name string
	data []byte
}

func inputs(t *testing.T) []input {
	t.Helper()
	var list []input
	files, _ := filepath.Glob(filepath.Join(testdata, "*.txt"))
	sort.Strings(files)
	for _, f := range files {
		if filepath.Base(f) == "message.txt" {
			continue
		}
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		list = append(list, input{filepath.Base(f), b})
	}
	real, _ := os.ReadFile(filepath.Join(testdata, "monero-hashes.txt"))
	rep := func(old, new string) []byte { return bytes.Replace(real, []byte(old), []byte(new), 1) }
	for name, data := range map[string][]byte{
		"real: CRLF":                bytes.ReplaceAll(real, []byte("\n"), []byte("\r\n")),
		"real: trailing whitespace": rep("## CLI\n", "## CLI \t\n"),
		"real: no final newline":    bytes.TrimSuffix(real, []byte("\n")),
		"real: hash changed":        rep("22a7dda7b0cb", "22a7dda7b0cc"),
		"real: line added":          rep("## GUI\n", "## GUI\nextra\n"),
		"real: text before":         append([]byte("evil\n"), real...),
		"real: text after":          append(append([]byte{}, real...), []byte("evil\n")...),
		"real: checksum changed":    rep("=WC0m", "=WC0n"),
		"real: checksum removed":    rep("=WC0m\n", ""),
		"real: armor header":        rep("-----BEGIN PGP SIGNATURE-----\n", "-----BEGIN PGP SIGNATURE-----\nVersion: x\n"),
		"real: message header":      rep("Hash: SHA256\n", "Hash: SHA256\nComment: x\n"),
		"real: Hash header SHA512":  rep("Hash: SHA256\n", "Hash: SHA512\n"),
		"real: Hash header missing": rep("Hash: SHA256\n", ""),
		"real: unescaped dash":      rep("## CLI\n", "-x\n## CLI\n"),
		"real: base64 changed":      rep("iQIzBAEBCAAdFiEEgaxZ", "iQIzBAEBCAAdFiEEgaxY"),
		"real: twice":               append(append([]byte{}, real...), real...),
	} {
		list = append(list, input{name, data})
	}
	sort.Slice(list, func(i, j int) bool { return list[i].name < list[j].name })
	return list
}

func TestGpgvAgrees(t *testing.T) {
	if _, err := exec.LookPath("gpgv"); err != nil {
		t.Skip("gpgv not installed")
	}
	signers := []signer{
		loadSigner(t, "monero", filepath.Join(testdata, "binaryfate.asc")),
		loadSigner(t, "A", filepath.Join(testdata, "testkey-a.asc")),
		loadSigner(t, "B", filepath.Join(testdata, "testkey-b.asc")),
	}
	if signers[0].key.Fingerprint != hashsig.MoneroReleaseKey.Fingerprint {
		t.Fatal("published key and pinned key differ")
	}
	var table strings.Builder
	accepted := 0
	for _, in := range inputs(t) {
		for _, s := range signers {
			o, g := ours(in.data, s), gpgvVerdict(t, in.data, s)
			key := in.name + "/" + s.name
			mark := "same"
			switch {
			case o.accepted && g.accepted && o.text != g.text:
				t.Errorf("%s: both accept, texts differ\nours %q\ngpgv %q", key, o.text, g.text)
				mark = "TEXT DIFFERS"
			case o.accepted != g.accepted:
				if why, ok := expectedDifferences[key]; ok && !o.accepted {
					mark = "expected: " + why
				} else {
					t.Errorf("%s: ours accepted=%v (%s), gpgv accepted=%v (%s)", key, o.accepted, o.detail, g.accepted, g.detail)
					mark = "DIFFERS"
				}
			}
			if o.accepted {
				accepted++
			}
			table.WriteString(key + "\tours=" + yes(o.accepted) + "\tgpgv=" + yes(g.accepted) + "\t" + mark + "\n")
		}
	}
	if accepted < 6 {
		t.Errorf("only %d acceptances: the comparison isn't exercising valid inputs", accepted)
	}
	t.Log("\n" + table.String())
}

func yes(b bool) string {
	if b {
		return "accept"
	}
	return "refuse"
}
