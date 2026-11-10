package auth

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/identity"
)

// ErrRefused is wrapped by every reason a token or a sign-in is turned away; the caller learns
// only that nobody is signed in, the log learns why.
var ErrRefused = errors.New("refused")

func refused(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrRefused, fmt.Sprintf(format, args...))
}

// discoveryTimeout bounds every request to a provider for its metadata and keys, so a provider
// that hangs costs a request seconds, not the function's whole timeout.
const discoveryTimeout = 5 * time.Second

// discovery finds each provider's endpoints once per execution environment, on first use, and
// tries again after a failure rather than remembering it. Each issuer has a lock of its own, so a
// provider that is slow to answer holds up only the requests that need it. The provider it
// returns caches its signing keys, fetching them again only for a key it does not know.
type discovery struct {
	mu      sync.Mutex
	issuers map[string]*discovered
}

type discovered struct {
	mu       sync.Mutex
	provider *oidc.Provider
}

func (d *discovery) provider(ctx context.Context, issuer string) (*oidc.Provider, error) {
	d.mu.Lock()
	if d.issuers == nil {
		d.issuers = map[string]*discovered{}
	}
	entry, ok := d.issuers[issuer]
	if !ok {
		entry = &discovered{}
		d.issuers[issuer] = entry
	}
	d.mu.Unlock()

	entry.mu.Lock()
	defer entry.mu.Unlock()
	if entry.provider != nil {
		return entry.provider, nil
	}
	// The client goes with the provider and is what fetches its keys later, so it is bounded too.
	client := &http.Client{Timeout: discoveryTimeout}
	ctx, cancel := context.WithTimeout(oidc.ClientContext(ctx, client), discoveryTimeout)
	defer cancel()
	p, err := oidc.NewProvider(ctx, issuer)
	if err != nil {
		return nil, fmt.Errorf("discover %s: %w", issuer, err)
	}
	entry.provider = p
	return p, nil
}

// claims are the parts of an ID token sign-in reads.
type claims struct {
	Subject       string          `json:"sub"`
	Email         string          `json:"email"`
	EmailVerified json.RawMessage `json:"email_verified"`
	Name          string          `json:"name"`
	Picture       string          `json:"picture"`
	Nonce         string          `json:"nonce"`
	Type          any             `json:"typ"`
	TokenUse      any             `json:"token_use"`
}

// verified reads email_verified as the Quarkus backend does (VerifiedEmail): the boolean true,
// as Google and Keycloak send it, or the string "true" in any case, as Cognito has sent it.
func (c claims) verified() bool {
	var b bool
	if json.Unmarshal(c.EmailVerified, &b) == nil {
		return b
	}
	var s string
	return json.Unmarshal(c.EmailVerified, &s) == nil && strings.EqualFold(s, "true")
}

// declaresOtherThanID is true for a token that says it is not an ID token: Keycloak's typ and
// Cognito's token_use name an access token so.
func declaresOtherThanID(value any) bool {
	return value != nil && !strings.EqualFold(fmt.Sprint(value), "id")
}

// verifyIDToken checks a raw ID token from p: signature, issuer and expiry (go-oidc), that it was
// issued to one of audiences, that it is an ID token, and that the provider vouches for the email.
func verifyIDToken(ctx context.Context, d *discovery, p Provider, raw string, audiences []string) (identity.Identity, claims, error) {
	op, err := d.provider(ctx, p.Issuer)
	if err != nil {
		return identity.Identity{}, claims{}, err
	}
	// Verifier, not VerifierContext: VerifierContext fetches the keys anew for every token.
	token, err := op.Verifier(&oidc.Config{SkipClientIDCheck: true}).Verify(ctx, raw)
	if err != nil {
		return identity.Identity{}, claims{}, refused("%v", err)
	}
	if !slices.ContainsFunc(token.Audience, func(a string) bool { return slices.Contains(audiences, a) }) {
		return identity.Identity{}, claims{}, refused("the token was issued to another application")
	}
	var c claims
	if err := token.Claims(&c); err != nil {
		return identity.Identity{}, claims{}, refused("unreadable claims: %v", err)
	}
	if declaresOtherThanID(c.Type) || declaresOtherThanID(c.TokenUse) {
		return identity.Identity{}, claims{}, refused("the token is an access token, not an ID token")
	}
	if strings.TrimSpace(c.Email) == "" {
		return identity.Identity{}, claims{}, refused("the token carries no email")
	}
	if !c.verified() {
		return identity.Identity{}, claims{}, refused("the provider does not say the email is verified")
	}
	return identity.Identity{Email: c.Email, Name: c.Name, Picture: c.Picture, Provider: p.ID, Subject: c.Subject}, c, nil
}

// issuerOf reads a JWT's iss claim without verifying anything, to choose the provider whose keys
// will verify it; nothing else is taken from an unverified token.
func issuerOf(raw string) (string, bool) {
	parts := strings.Split(raw, ".")
	if len(parts) != 3 {
		return "", false
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", false
	}
	var c struct {
		Issuer string `json:"iss"`
	}
	if json.Unmarshal(payload, &c) != nil || c.Issuer == "" {
		return "", false
	}
	return c.Issuer, true
}
