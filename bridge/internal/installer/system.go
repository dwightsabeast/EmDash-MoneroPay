package installer

import (
	"bytes"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
)

// realSystem is this machine (useradd, userdel and systemctl from the distribution).
type realSystem struct{}

// RealSystem returns the System for this machine.
func RealSystem() System { return realSystem{} }

func (realSystem) Euid() int { return os.Geteuid() }

func (realSystem) HasSystemd() bool {
	fi, err := os.Stat("/run/systemd/system")
	return err == nil && fi.IsDir()
}

func (realSystem) LookupUser(name string) (int, int, bool, error) {
	u, err := user.Lookup(name)
	var unknown user.UnknownUserError
	if errors.As(err, &unknown) {
		return 0, 0, false, nil
	}
	if err != nil {
		return 0, 0, false, err
	}
	uid, err1 := strconv.Atoi(u.Uid)
	gid, err2 := strconv.Atoi(u.Gid)
	if err1 != nil || err2 != nil {
		return 0, 0, false, fmt.Errorf("the %s user has unexpected ids", name)
	}
	return uid, gid, true, nil
}

func run(name string, args ...string) error {
	var out bytes.Buffer
	cmd := exec.Command(name, args...)
	cmd.Stdout, cmd.Stderr = &out, &out
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("%s %s: %v: %s", name, strings.Join(args, " "), err, strings.TrimSpace(out.String()))
	}
	return nil
}

func (realSystem) AddSystemUser(name, home string) error {
	shell := "/usr/sbin/nologin"
	if _, err := os.Stat(shell); err != nil {
		shell = "/sbin/nologin"
	}
	return run("useradd", "--system", "--user-group", "--home-dir", home, "--no-create-home", "--shell", shell, name)
}

func (realSystem) DeleteUser(name string) error { return run("userdel", name) }

func (realSystem) Chown(path string, uid, gid int) error {
	return filepath.WalkDir(path, func(p string, _ fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		return os.Lchown(p, uid, gid) // never follows a symlink
	})
}

func (realSystem) Systemctl(args ...string) error { return run("systemctl", args...) }
