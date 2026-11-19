package auth

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
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
	t      *testing.T
	server *httptest.Server
	// key is the client's, which signs its client secret; idKey is Apple's, which signs ID tokens.
	key   *ecdsa.PrivateKey
	idKey *rsa.PrivateKey
	mu    sync.Mutex
	// codes are the authorization codes Apple's sheet issued: to which client, for which person.
	codes map[string]appleCode
	// exchanged and revoked are the forms the two endpoints were sent, for the test to look at.
	exchanged, revoked []url.Values
	// revocation is what the revocation endpoint answers; 200 unless a test says otherwise.
	revocation int
}

// appleCode is an authorization code as Apple's sheet issued it.
type appleCode struct{ client, subject string }

func newFakeApple(t *testing.T) *fakeApple {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	idKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	a := &fakeApple{t: t, key: key, idKey: idKey, codes: map[string]appleCode{}, revocation: http.StatusOK}
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
	mux.HandleFunc("GET /auth/keys", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{
			{Key: &idKey.PublicKey, KeyID: "apple-1", Algorithm: "RS256", Use: "sig"},
		}})
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
	issued, ok := a.codes[r.PostForm.Get("code")]
	delete(a.codes, r.PostForm.Get("code"))
	a.mu.Unlock()
	if !ok || issued.client != r.PostForm.Get("client_id") || !a.signedBy(r.PostForm) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid_grant"}`))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"access_token": "access-1", "token_type": "Bearer", "expires_in": 3600, "refresh_token": "refresh-1",
		"id_token": a.idToken(issued),
	})
}

// idToken is the ID token Apple hands out with the tokens: no email, since none was asked for.
func (a *fakeApple) idToken(issued appleCode) string {
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: a.idKey},
		(&jose.SignerOptions{}).WithType("JWT").WithHeader("kid", "apple-1"))
	if err != nil {
		a.t.Fatal(err)
	}
	now := time.Now()
	raw, err := jwt.Signed(signer).Claims(map[string]any{
		"iss": AppleIssuer, "aud": issued.client, "sub": issued.subject,
		"iat": now.Unix(), "exp": now.Add(10 * time.Minute).Unix(),
	}).Serialize()
	if err != nil {
		a.t.Fatal(err)
	}
	return raw
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
	apple.codes["code-1"] = appleCode{client: "bundle-id", subject: "apple-subject"}

	revocation, err := s.RevocationForDeletion(r, "code-1")
	if err != nil || revocation == nil {
		t.Fatalf("revocation %v, err %v; want one", revocation != nil, err)
	}
	if len(apple.exchanged) != 0 {
		t.Fatalf("exchanged %v; want nothing sent to Apple before the deletion counts as done", apple.exchanged)
	}
	if err := revocation(context.Background()); err != nil {
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

	_, err := s.RevocationForDeletion(r, "")

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

	revocation, err := s.RevocationForDeletion(withBearer(f.sign(nil)), "")

	if err != nil || revocation != nil {
		t.Errorf("revocation %v, err %v; want none", revocation != nil, err)
	}
}

func TestADeletionWhoseRequestCannotBeIdentifiedIsRefused(t *testing.T) {
	s, apple, r := appleService(t)
	r.Header.Set("Authorization", "Bearer "+AppSessionPrefix+"ended-session")

	revocation, err := s.RevocationForDeletion(r, "code-1")

	if !errors.Is(err, ErrNotIdentified) || revocation != nil {
		t.Errorf("revocation %v, err %v; want ErrNotIdentified", revocation != nil, err)
	}
	if len(apple.exchanged) != 0 {
		t.Errorf("exchanged %v; want nothing sent to Apple", apple.exchanged)
	}
}

func TestAnotherAppleIDsConfirmationRevokesNothing(t *testing.T) {
	s, apple, r := appleService(t)
	apple.codes["code-1"] = appleCode{client: "bundle-id", subject: "someone-else"}

	revocation, err := s.RevocationForDeletion(r, "code-1")
	if err != nil {
		t.Fatal(err)
	}

	if err := revocation(context.Background()); err == nil {
		t.Error("want an error for another Apple ID's confirmation")
	}
	if len(apple.revoked) != 0 {
		t.Errorf("revoked %v; want nothing revoked of another Apple ID", apple.revoked)
	}
}

func TestACodeAppleWillNotExchangeOrARevocationItRefusesIsAnError(t *testing.T) {
	s, apple, r := appleService(t)

	revocation, err := s.RevocationForDeletion(r, "unknown-code")
	if err != nil {
		t.Fatal(err)
	}
	if err := revocation(context.Background()); err == nil {
		t.Error("want the exchange's failure")
	}

	apple.codes["code-1"] = appleCode{client: "bundle-id", subject: "apple-subject"}
	apple.revocation = http.StatusServiceUnavailable
	revocation, _ = s.RevocationForDeletion(r, "code-1")
	if err := revocation(context.Background()); err == nil {
		t.Error("want the revocation's failure")
	}
}
