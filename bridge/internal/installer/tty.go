package installer

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"syscall"
	"unsafe"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/secret"
)

const maxAnswer = 512

type prompter struct {
	in   *bufio.Reader
	out  io.Writer
	echo func(on bool) error
}

func newPrompter(in io.Reader, out io.Writer, echo func(on bool) error) *prompter {
	return &prompter{in: bufio.NewReaderSize(in, maxAnswer+2), out: out, echo: echo}
}

// OpenTTY returns a prompter on /dev/tty, which works when the installer's own input is a pipe from curl. Close it
// when done.
func OpenTTY() (Prompter, func() error, error) {
	f, err := os.OpenFile("/dev/tty", os.O_RDWR, 0)
	if err != nil {
		return nil, nil, errors.New("the installer needs a terminal to ask for the shop wallet's details")
	}
	fd := f.Fd()
	echo := func(on bool) error {
		var t syscall.Termios
		if _, _, e := syscall.Syscall(syscall.SYS_IOCTL, fd, syscall.TCGETS, uintptr(unsafe.Pointer(&t))); e != 0 {
			return fmt.Errorf("not a terminal: %w", e)
		}
		if on {
			t.Lflag |= syscall.ECHO
		} else {
			t.Lflag &^= syscall.ECHO
		}
		if _, _, e := syscall.Syscall(syscall.SYS_IOCTL, fd, syscall.TCSETS, uintptr(unsafe.Pointer(&t))); e != 0 {
			return fmt.Errorf("not a terminal: %w", e)
		}
		return nil
	}
	return newPrompter(f, f, echo), f.Close, nil
}

func (p *prompter) readLine() (string, error) {
	line, err := p.in.ReadSlice('\n')
	if errors.Is(err, bufio.ErrBufferFull) || len(line) > maxAnswer+1 {
		return "", errors.New("that answer is too long")
	}
	if err != nil && (len(line) == 0 || !errors.Is(err, io.EOF)) {
		return "", errors.New("no answer (end of input)")
	}
	return strings.TrimSpace(string(line)), nil
}

func (p *prompter) Ask(prompt string) (string, error) {
	fmt.Fprint(p.out, prompt)
	return p.readLine()
}

func (p *prompter) AskSecret(prompt string) (secret.String, error) {
	fmt.Fprint(p.out, prompt)
	if err := p.echo(false); err != nil {
		p.echo(true)
		return secret.String{}, err
	}
	line, err := p.readLine()
	p.echo(true)
	fmt.Fprintln(p.out)
	if err != nil {
		return secret.String{}, err
	}
	return secret.New(line), nil
}

func (p *prompter) Say(format string, a ...any) { fmt.Fprintf(p.out, format+"\n", a...) }
