// Package gravatar finds a person's Gravatar when their sign-in provider sent no picture, as the
// Quarkus backend does (doc/authentication.md, The Gravatar fallback): the backend asks, with
// d=404, so that "is there a picture" gets a true answer; the browser still loads the image.
package gravatar

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"
)

// DefaultBase is Gravatar's avatar URL, to which the address's hash is appended.
const DefaultBase = "https://gravatar.com/avatar/"

// query asks for a 404 instead of an invented picture, at the size the frontend shows.
const query = "?d=404&s=200"

// Gravatar looks pictures up, remembering each answer, yes or no, for the life of the execution
// environment:
// /api/auth/me is asked on every page load, and an outbound request each time would be a cost on
// the sign-in path. A failure is no answer, not an error: nobody is kept from their tasks because
// an avatar service is slow.
type Gravatar struct {
	enabled bool
	base    string
	client  *http.Client
	cache   sync.Map // email -> url, "" for none
}

// New returns a lookup against base (DefaultBase in production), or one that never finds
// anything when enabled is false.
func New(enabled bool, base string) *Gravatar {
	return &Gravatar{enabled: enabled, base: base, client: &http.Client{
		Timeout: 2 * time.Second,
		// A redirect is not a picture.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}
}

// URL is the Gravatar URL for an address: its trimmed, lower-cased SHA-256, as Gravatar asks.
func URL(base, email string) string {
	sum := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(email))))
	return base + hex.EncodeToString(sum[:]) + query
}

// Lookup returns the address's Gravatar if one exists, or "".
func (g *Gravatar) Lookup(ctx context.Context, email string) string {
	if !g.enabled {
		return ""
	}
	if url, ok := g.cache.Load(email); ok {
		return url.(string)
	}
	url := URL(g.base, email)
	exists, answered := g.exists(ctx, url)
	if !exists {
		url = ""
	}
	if answered {
		// Only an answer is remembered; a failure is asked again next time.
		g.cache.Store(email, url)
	}
	return url
}

// exists asks whether there is a picture at url. Only a 200 or a 404 is an answer: anything else,
// a 429 telling us to slow down included, says nothing about the picture and is asked again.
func (g *Gravatar) exists(ctx context.Context, url string) (exists, answered bool) {
	req, err := http.NewRequestWithContext(ctx, http.MethodHead, url, nil)
	if err != nil {
		return false, false
	}
	res, err := g.client.Do(req)
	if err != nil {
		slog.WarnContext(ctx, "asking Gravatar failed", "error", err)
		return false, false
	}
	_ = res.Body.Close()
	switch res.StatusCode {
	case http.StatusOK:
		return true, true
	case http.StatusNotFound:
		return false, true
	default:
		return false, false
	}
}
