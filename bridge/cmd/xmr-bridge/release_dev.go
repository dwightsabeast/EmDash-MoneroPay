//go:build devrelease

package main

import (
	"crypto/ed25519"
	"encoding/base64"
	"time"
)

// Development builds (-tags devrelease) for testing the update path before real releases exist. The dev public key
// and the dev release address are set at build time by scripts/build-dev-release.sh:
//
//	-ldflags "-X main.devReleaseKey=<base64 public key> -X main.devReleaseURL=http://127.0.0.1:8099"
//
// A dev build updates only when the open wallet's address is a stagenet address (checked through wallet-rpc). Delays
// are short so a test doesn't take two days.
const devBuild = true

var (
	devReleaseKey string
	devReleaseURL string
)

func releaseKeys() []ed25519.PublicKey {
	k, err := base64.StdEncoding.DecodeString(devReleaseKey)
	if err != nil || len(k) != ed25519.PublicKeySize {
		return nil
	}
	return []ed25519.PublicKey{k}
}

func releaseBase() string { return devReleaseURL }

const (
	updateDelay     = 2 * time.Minute
	walletRPCDelay  = 2 * time.Minute
	firstCheckAfter = 20 * time.Second
	checkEvery      = time.Minute
	checkJitter     = 0
)
