package auth

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
	"github.com/guhilling/ai-assisted-todolist/serverless/internal/identity"
)

// fakeApple is Sign in with Apple's token and revocation endpoints as #635 uses them: a code the
// app's sheet issued to the app's bundle id is exchanged for tokens, and the refresh token among
// them is revoked, each with a client secret the client signed with its key.
type fakeApple struct {
	server *httptest.Server
	key    *ecdsa.PrivateKey
	mu     sync.Mutex
	// codes are the authorization codes Apple's sheet issued, and to which client.
	codes map[string]string
	// exchanged and revoked are the forms the two endpoints were sent, for the test to look at.
	exchanged, revoked []url.Values
	// revocation is what the revocation endpoint answers; 200 unless a test says otherwise.
	revocation int
}

func newFakeApple(t *testing.T) *fakeApple {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	a := &fakeApple{key: key, codes: map[string]string{}, revocation: http.StatusOK}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /.well-known/openid-configuration", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"issuer":                                AppleIssuer,
			"authorization_endpoint":                a.server.URL + "/auth/authorize",
			"token_endpoint":                        a.server.URL + "/auth/token",
			"revocation_endpoint":                   a.server.URL + "/auth/revoke",
			"jwks_uri":                              a.server.URL + "/auth/keys",
			"token_endpoint_auth_methods_supported": []string{"client_secret_post"},
			"id_token_signing_alg_values_supported": []string{"RS256"},
		})
	})
	mux.HandleFunc("POST /auth/token", a.token)
	mux.HandleFunc("POST /auth/revoke", a.revoke)
	a.server = httptest.NewServer(mux)
	t.Cleanup(a.server.Close)
	return a
}

// signedBy says whether form carries a client secret signed with the client's key about the
// client it names, as Apple requires of both endpoints.
func (a *fakeApple) signedBy(form url.Values) bool {
	signed, err := jwt.ParseSigned(form.Get("client_secret"), []jose.SignatureAlgorithm{jose.ES256})
	var c jwt.Claims
	return err == nil && signed.Claims(&a.key.PublicKey, &c) == nil && c.Subject == form.Get("client_id")
}

func (a *fakeApple) token(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	a.mu.Lock()
	a.exchanged = append(a.exchanged, r.PostForm)
	client, ok := a.codes[r.PostForm.Get("code")]
	delete(a.codes, r.PostForm.Get("code"))
	a.mu.Unlock()
	if !ok || client != r.PostForm.Get("client_id") || !a.signedBy(r.PostForm) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid_grant"}`))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"access_token": "access-1", "token_type": "Bearer", "expires_in": 3600, "refresh_token": "refresh-1",
	})
}

func (a *fakeApple) revoke(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	a.mu.Lock()
	defer a.mu.Unlock()
	a.revoked = append(a.revoked, r.PostForm)
	if !a.signedBy(r.PostForm) {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	w.WriteHeader(a.revocation)
}

// provider is Apple as a deployment configures it: the website's Services ID as its client, and
// the app's bundle id among the audiences its ID tokens may be issued to.
func (a *fakeApple) provider() Provider {
	return Provider{ID: "apple", Issuer: AppleIssuer, DiscoveryURL: a.server.URL, ClientID: "services-id",
		SigningKey: a.key, SigningKeyID: "KEY1234567", SigningTeamID: "TEAM123456",
		ResponseMode: ResponseModeFormPost, Audiences: []string{"services-id", "bundle-id"}}
}

// appleService is a deployment offering Apple beside its main provider, with an app session
// started from an Apple sign-in, and the request that deletes its account.
func appleService(t *testing.T) (*Service, *fakeApple, *http.Request) {
	t.Helper()
	apple := newFakeApple(t)
	s, store := serviceFor(newFakeProvider(t), apple.provider())
	now := time.Now()
	token := AppSessionPrefix + "apple-session"
	err := store.PutSession(context.Background(), hash(token), Session{
		Identity: identity.Identity{Email: "person@example.com", Provider: "apple", Subject: "apple-subject"},
		Created:  now, LastSeen: now, App: true,
	}, now.Add(AppLifetime))
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest("DELETE", "/api/account", nil)
	r.Header.Set("Authorization", "Bearer "+token)
	return s, apple, r
}

func TestDeletingAnAppleAccountRevokesTheRefreshTokenAFreshCodeBrings(t *testing.T) {
	s, apple, r := appleService(t)
	apple.codes["code-1"] = "bundle-id"

	if err := s.RevokeForDeletion(r, "code-1"); err != nil {
		t.Fatal(err)
	}

	if len(apple.exchanged) != 1 || apple.exchanged[0].Get("grant_type") != "authorization_code" ||
		apple.exchanged[0].Get("client_id") != "bundle-id" {
		t.Errorf("exchanged %v; want the code exchanged as the app's bundle id", apple.exchanged)
	}
	if len(apple.revoked) != 1 || apple.revoked[0].Get("token") != "refresh-1" ||
		apple.revoked[0].Get("token_type_hint") != "refresh_token" || apple.revoked[0].Get("client_id") != "bundle-id" {
		t.Errorf("revoked %v; want the refresh token revoked as the app's bundle id", apple.revoked)
	}
}

func TestDeletingAnAppleAccountWithoutAppleConfirmingItIsRefused(t *testing.T) {
	s, apple, r := appleService(t)

	err := s.RevokeForDeletion(r, "")

	if !errors.Is(err, ErrAppleConfirmationNeeded) {
		t.Errorf("err %v; want ErrAppleConfirmationNeeded", err)
	}
	if len(apple.exchanged) != 0 {
		t.Errorf("exchanged %v; want nothing sent to Apple", apple.exchanged)
	}
}

func TestDeletingAnAccountSignedInWithAnotherProviderAsksNothingOfApple(t *testing.T) {
	apple := newFakeApple(t)
	f := newFakeProvider(t)
	s, _ := serviceFor(f, apple.provider())

	if err := s.RevokeForDeletion(withBearer(f.sign(nil)), ""); err != nil {
		t.Errorf("err %v; want none", err)
	}
	if len(apple.exchanged) != 0 {
		t.Errorf("exchanged %v; want nothing sent to Apple", apple.exchanged)
	}
}

func TestACodeAppleWillNotExchangeOrARevocationItRefusesIsAnError(t *testing.T) {
	s, apple, r := appleService(t)

	if err := s.RevokeForDeletion(r, "unknown-code"); err == nil || errors.Is(err, ErrAppleConfirmationNeeded) {
		t.Errorf("err %v; want the exchange's failure", err)
	}

	apple.codes["code-1"] = "bundle-id"
	apple.revocation = http.StatusServiceUnavailable
	if err := s.RevokeForDeletion(r, "code-1"); err == nil || errors.Is(err, ErrAppleConfirmationNeeded) {
		t.Errorf("err %v; want the revocation's failure", err)
	}
}
