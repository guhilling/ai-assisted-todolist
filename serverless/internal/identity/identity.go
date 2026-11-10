// Package identity is who sent a request: the email that identifies them, and what their provider
// said about them besides. It is the one thing sign-in hands to the rest of the backend.
package identity

// Identity is a signed-in person. The email is the whole of the identity (doc/domain-model.md):
// the same address from any provider is the same person. Name and picture are how they are
// shown their own session, never stored with their tasks (doc/authentication.md).
type Identity struct {
	// Email is the verified address; never empty.
	Email string
	// Name is the provider's display name, or empty when it sent none.
	Name string
	// Picture is the provider's picture, else a Gravatar known to exist, or empty for neither.
	Picture string
	// Provider is the id of the provider that vouched for the email, such as "google".
	Provider string
	// Subject is the provider's own id for the person, for the sign-in log.
	Subject string
}
