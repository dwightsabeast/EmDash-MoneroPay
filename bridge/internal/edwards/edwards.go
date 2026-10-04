// Package edwards computes k*B on the Ed25519 curve (B the standard base point) for a raw little-endian scalar k,
// which Go's standard library doesn't expose. The bridge uses it once, at install, to check that the private view
// key an admin typed belongs to the shop address, and that it isn't the spend key (spec change 11): wallet-rpc
// doesn't check. Plain math/big, extended twisted-Edwards coordinates with the complete addition law (a = -1);
// not constant-time, which is acceptable for a single local check of a value the admin just typed.
package edwards

import "math/big"

var (
	p = func() *big.Int { v := new(big.Int).Lsh(big.NewInt(1), 255); return v.Sub(v, big.NewInt(19)) }()
	// d = -121665/121666 mod p
	d = func() *big.Int {
		v := new(big.Int).ModInverse(big.NewInt(121666), p)
		v.Mul(v, big.NewInt(-121665))
		return v.Mod(v, p)
	}()
	d2 = new(big.Int).Mod(new(big.Int).Lsh(d, 1), p)
	bx = mustInt("15112221349535400772501151409588531511454012693041857206046113283949847762202")
	by = mustInt("46316835694926478169428394003475163141307993866256225615783033603165251855960")
)

func mustInt(s string) *big.Int {
	v, ok := new(big.Int).SetString(s, 10)
	if !ok {
		panic("edwards: bad constant")
	}
	return v
}

// point is (X:Y:Z:T) with x = X/Z, y = Y/Z, x*y = T/Z.
type point struct{ x, y, z, t *big.Int }

func identity() point { return point{big.NewInt(0), big.NewInt(1), big.NewInt(1), big.NewInt(0)} }

func base() point {
	return point{new(big.Int).Set(bx), new(big.Int).Set(by), big.NewInt(1), new(big.Int).Mod(new(big.Int).Mul(bx, by), p)}
}

func mod(v *big.Int) *big.Int { return v.Mod(v, p) }

// add is the complete addition law for a = -1 (it also doubles).
func add(a, b point) point {
	A := mod(new(big.Int).Mul(mod(new(big.Int).Sub(a.y, a.x)), mod(new(big.Int).Sub(b.y, b.x))))
	B := mod(new(big.Int).Mul(new(big.Int).Add(a.y, a.x), new(big.Int).Add(b.y, b.x)))
	C := mod(new(big.Int).Mul(mod(new(big.Int).Mul(a.t, d2)), b.t))
	D := mod(new(big.Int).Mul(new(big.Int).Lsh(a.z, 1), b.z))
	E := mod(new(big.Int).Sub(B, A))
	F := mod(new(big.Int).Sub(D, C))
	G := mod(new(big.Int).Add(D, C))
	H := mod(new(big.Int).Add(B, A))
	return point{
		x: mod(new(big.Int).Mul(E, F)),
		y: mod(new(big.Int).Mul(G, H)),
		t: mod(new(big.Int).Mul(E, H)),
		z: mod(new(big.Int).Mul(F, G)),
	}
}

// encode is the standard 32-byte encoding: y little-endian, the top bit set when x is odd.
func encode(q point) []byte {
	zi := new(big.Int).ModInverse(q.z, p)
	x := mod(new(big.Int).Mul(q.x, zi))
	y := mod(new(big.Int).Mul(q.y, zi))
	be := y.FillBytes(make([]byte, 32))
	out := make([]byte, 32)
	for i := range be {
		out[31-i] = be[i]
	}
	if x.Bit(0) == 1 {
		out[31] |= 0x80
	}
	return out
}

// ScalarBaseMult returns the encoding of k*B for the 32-byte little-endian scalar k (any value; it is used as is).
func ScalarBaseMult(k []byte) []byte {
	if len(k) != 32 {
		panic("edwards: scalar must be 32 bytes")
	}
	r, b := identity(), base()
	for i := 0; i < 256; i++ {
		if k[i/8]>>(i%8)&1 == 1 {
			r = add(r, b)
		}
		b = add(b, b)
	}
	return encode(r)
}
