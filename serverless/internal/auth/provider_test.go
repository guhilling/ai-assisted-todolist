package auth

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
)

// fakeProvider is an OpenID Connect provider for the tests: discovery, keys, and a token
// endpoint that hands out the ID token registered for a code, once, to the client that proves
// the PKCE verifier.
type fakeProvider struct {
	t      *testing.T
	server *httptest.Server
	key    *rsa.PrivateKey
	mu     sync.Mutex
	codes  map[string]issuedCode
}

type issuedCode struct {
	claims    map[string]any
	challenge string
}

func newFakeProvider(t *testing.T) *fakeProvider {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	f := &fakeProvider{t: t, key: key, codes: map[string]issuedCode{}}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /.well-known/openid-configuration", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"issuer":                                f.issuer(),
			"authorization_endpoint":                f.issuer() + "/authorize",
			"token_endpoint":                        f.issuer() + "/token",
			"jwks_uri":                              f.issuer() + "/keys",
			"id_token_signing_alg_values_supported": []string{"RS256"},
		})
	})
	mux.HandleFunc("GET /keys", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{
			{Key: &key.PublicKey, KeyID: "k1", Algorithm: "RS256", Use: "sig"},
		}})
	})
	mux.HandleFunc("POST /token", f.token)
	f.server = httptest.NewServer(mux)
	t.Cleanup(f.server.Close)
	return f
}

func (f *fakeProvider) issuer() string { return f.server.URL }

// sign returns an ID token with these claims over the defaults: issued by this provider to
// "web-client", now, for an hour, with a verified email.
func (f *fakeProvider) sign(overrides map[string]any) string {
	return f.signWith(f.key, overrides)
}

func (f *fakeProvider) signWith(key *rsa.PrivateKey, overrides map[string]any) string {
	f.t.Helper()
	now := time.Now()
	claims := map[string]any{
		"iss": f.issuer(), "aud": "web-client", "sub": "subject-1",
		"iat": now.Unix(), "exp": now.Add(time.Hour).Unix(),
		"email": "person@example.com", "email_verified": true, "name": "Person Example",
	}
	for k, v := range overrides {
		if v == nil {
			delete(claims, k)
		} else {
			claims[k] = v
		}
	}
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: key},
		(&jose.SignerOptions{}).WithType("JWT").WithHeader("kid", "k1"))
	if err != nil {
		f.t.Fatal(err)
	}
	raw, err := jwt.Signed(signer).Claims(claims).Serialize()
	if err != nil {
		f.t.Fatal(err)
	}
	return raw
}

// issue registers a code the token endpoint will exchange for an ID token with these claims,
// for the client that started with this PKCE challenge.
func (f *fakeProvider) issue(code, challenge string, claims map[string]any) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.codes[code] = issuedCode{claims: claims, challenge: challenge}
}

func (f *fakeProvider) token(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	f.mu.Lock()
	issued, ok := f.codes[r.PostForm.Get("code")]
	delete(f.codes, r.PostForm.Get("code"))
	f.mu.Unlock()
	sum := sha256.Sum256([]byte(r.PostForm.Get("code_verifier")))
	user, secret, _ := r.BasicAuth()
	if !ok || base64.RawURLEncoding.EncodeToString(sum[:]) != issued.challenge ||
		user != "web-client" || secret != "web-secret" {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid_grant"}`))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"access_token": "opaque", "token_type": "Bearer", "expires_in": 3600,
		"id_token": f.sign(issued.claims),
	})
}

// memStore keeps sessions and sign-ins under way in memory, as DynamoDB would.
type memStore struct {
	mu       sync.Mutex
	sessions map[string]Session
	pending  map[string]PendingSignIn
	expires  map[string]time.Time
}

func newMemStore() *memStore {
	return &memStore{sessions: map[string]Session{}, pending: map[string]PendingSignIn{}, expires: map[string]time.Time{}}
}

func (m *memStore) PutSession(_ context.Context, key string, s Session, expires time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sessions[key], m.expires[key] = s, expires
	return nil
}

func (m *memStore) GetSession(_ context.Context, key string) (Session, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[key]
	return s, ok, nil
}

func (m *memStore) TouchSession(_ context.Context, key string, lastSeen, expires time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	s := m.sessions[key]
	s.LastSeen = lastSeen
	m.sessions[key], m.expires[key] = s, expires
	return nil
}

func (m *memStore) DeleteSession(_ context.Context, key string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.sessions, key)
	return nil
}

func (m *memStore) PutPendingSignIn(_ context.Context, key string, p PendingSignIn, _ time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.pending[key] = p
	return nil
}

func (m *memStore) TakePendingSignIn(_ context.Context, key string) (PendingSignIn, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	p, ok := m.pending[key]
	delete(m.pending, key)
	return p, ok, nil
}

// noAvatars finds a picture for nobody, and counts the lookups.
type noAvatars struct{ asked int }

func (n *noAvatars) Lookup(context.Context, string) string {
	n.asked++
	return ""
}

// fixedAvatars finds the same picture for everybody.
type fixedAvatars string

func (f fixedAvatars) Lookup(context.Context, string) string { return string(f) }
