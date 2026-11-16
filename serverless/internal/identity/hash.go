package identity

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

// Canonical is the email as the identity knows it: lower-cased, so that Gunnar@Example.com and
// gunnar@example.com are one person whichever case a provider sends (Gunnar's decision on #622).
// Nothing else about the address is changed. It is the one place the case is ignored; which
// email an account is keyed by, this one or an older account's as sent, internal/store decides
// (Accounts.AccountEmail).
func Canonical(email string) string {
	return strings.ToLower(email)
}

// EmailHash is the SHA-256 of the email exactly as given, in lower-case hex: what a user's items
// are keyed by, and what names their deletion record (#553). It is given the email the account is
// keyed by (internal/store's Accounts.AccountEmail), never one straight from a provider. It is
// pseudonymous, not anonymous: anyone who knows an address can compute it (the privacy policy
// says so).
func EmailHash(email string) string {
	sum := sha256.Sum256([]byte(email))
	return hex.EncodeToString(sum[:])
}
