package secret

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"testing"
)

const value = "do-not-print-me-9f3a"

func TestNeverPrinted(t *testing.T) {
	s := New(value)
	wrapped := struct {
		Name string
		Key  String
		Ptr  *String
	}{"x", s, &s}

	var out []string
	for _, verb := range []string{"%v", "%+v", "%#v", "%s", "%q", "%x", "%X", "%d", "%T"} {
		out = append(out, fmt.Sprintf(verb, s), fmt.Sprintf(verb, wrapped), fmt.Sprintf(verb, &s))
	}
	out = append(out, fmt.Sprint(s), fmt.Sprintln(wrapped), s.String())

	j, err := json.Marshal(wrapped)
	if err != nil {
		t.Fatal(err)
	}
	out = append(out, string(j))

	var buf bytes.Buffer
	log := slog.New(slog.NewTextHandler(&buf, nil))
	log.Info("m", "key", s, "ptr", &s, "struct", wrapped, slog.Any("any", s))
	jbuf := new(bytes.Buffer)
	slog.New(slog.NewJSONHandler(jbuf, nil)).Info("m", "key", s, "struct", wrapped)
	out = append(out, buf.String(), jbuf.String())

	hexValue := fmt.Sprintf("%x", value)
	for _, o := range out {
		if strings.Contains(o, value) || strings.Contains(strings.ToLower(o), hexValue) {
			t.Fatalf("secret leaked: %q", o)
		}
	}
	if !strings.Contains(buf.String(), "key=[redacted]") {
		t.Fatalf("expected a redaction marker in the log, got %q", buf.String())
	}
}

func TestRevealAndEmpty(t *testing.T) {
	if New(value).Reveal() != value {
		t.Fatal("Reveal must return the value")
	}
	if !New("").IsEmpty() || New("a").IsEmpty() {
		t.Fatal("IsEmpty")
	}
	var zero String
	if zero.Reveal() != "" || !zero.IsEmpty() {
		t.Fatal("zero value is empty")
	}
}

func TestUnmarshalRefused(t *testing.T) {
	var s String
	if err := json.Unmarshal([]byte(`"x"`), &s); err == nil {
		t.Fatal("secrets are never read from JSON")
	}
}
