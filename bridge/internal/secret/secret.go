// Package secret holds values that must never be printed, logged or serialized: the view key, the wallet password,
// the wallet-rpc login, the pairing code and the bridge's private key. Every way Go formats a value (fmt verbs,
// slog, encoding/json) prints "[redacted]"; only Reveal returns the value, at the one place that needs it.
package secret

import (
	"errors"
	"fmt"
	"log/slog"
)

const redacted = "[redacted]"

// String is a secret string. The zero value is empty.
type String struct{ v string }

// New wraps a secret value.
func New(v string) String { return String{v: v} }

// Reveal returns the value. Call it only where the value is handed to the program that needs it.
func (s String) Reveal() string { return s.v }

// IsEmpty reports whether the value is empty.
func (s String) IsEmpty() bool { return s.v == "" }

func (String) String() string               { return redacted }
func (String) GoString() string             { return redacted }
func (String) LogValue() slog.Value         { return slog.StringValue(redacted) }
func (String) Format(f fmt.State, _ rune)   { _, _ = f.Write([]byte(redacted)) }
func (String) MarshalText() ([]byte, error) { return []byte(redacted), nil }
func (*String) UnmarshalText([]byte) error  { return errNoUnmarshal }

var errNoUnmarshal = errors.New("secret: values are never read from serialized data")
