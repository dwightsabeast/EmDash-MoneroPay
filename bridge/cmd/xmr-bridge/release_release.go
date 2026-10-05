//go:build !devrelease

package main

import (
	"crypto/ed25519"
	"time"
)

// Release builds. The release public key is pinned in phase 09, when Wyatt provides it (decisions.md); until then
// automatic updates report "off: no release key pinned yet". No dev key and no dev release address exist in this
// file, and TestReleaseBuildHasNoDevValues proves the linked binary doesn't contain them.
const devBuild = false

func releaseKeys() []ed25519.PublicKey { return nil }

// devBreakMode is always "" in release builds (see release_dev.go).
func devBreakMode() string { return "" }

func releaseBase() string { return "https://REPLACE-RELEASE-HOST.invalid/xmr-bridge/latest" }

const (
	updateDelay     = 48 * time.Hour // after a bridge release's signed date
	walletRPCDelay  = 48 * time.Hour // after a new wallet-rpc version is first seen
	firstCheckAfter = 10 * time.Minute
	checkEvery      = 24 * time.Hour
	checkJitter     = time.Hour
)
