package identity

import (
	"crypto/sha256"
	"encoding/hex"
)

// EmailHash is the SHA-256 of the email exactly as the provider sent it, in lower-case hex: what
// a user's items are keyed by, and what names their deletion record (#553). It is pseudonymous,
// not anonymous: anyone who knows an address can compute it (the privacy policy says so).
func EmailHash(email string) string {
	sum := sha256.Sum256([]byte(email))
	return hex.EncodeToString(sum[:])
}
