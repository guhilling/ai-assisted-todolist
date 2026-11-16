package auth

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
)

// postingProvider is a provider shaped like Sign in with Apple's: it returns the browser by a
// form POST, its token endpoint takes the client's credentials in the form body only
// (client_secret_post), and the client secret it takes is a JWT the client signed with its key.
type postingProvider struct {
	*fakeProvider
	key *ecdsa.PrivateKey
	// secrets are the client secrets the token endpoint was sent, for the test to look at.
	secrets []string
	// verifierSent is whether any exchange came with a PKCE code verifier.
	verifierSent bool
}

func newPostingProvider(t *testing.T) *postingProvider {
	t.Helper()
	rsaKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	ecKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	p := &postingProvider{fakeProvider: &fakeProvider{t: t, key: rsaKey, codes: map[string]issuedCode{}}, key: ecKey}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /.well-known/openid-configuration", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"issuer":                                p.issuer(),
			"authorization_endpoint":                p.issuer() + "/authorize",
			"token_endpoint":                        p.issuer() + "/token",
			"jwks_uri":                              p.issuer() + "/keys",
			"response_modes_supported":              []string{"query", "fragment", "form_post"},
			"token_endpoint_auth_methods_supported": []string{"client_secret_post"},
			"id_token_signing_alg_values_supported": []string{"RS256"},
		})
	})
	mux.HandleFunc("GET /keys", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{
			{Key: &rsaKey.PublicKey, KeyID: "k1", Algorithm: "RS256", Use: "sig"},
		}})
	})
	mux.HandleFunc("POST /token", p.token)
	p.server = httptest.NewServer(mux)
	t.Cleanup(p.server.Close)
	return p
}

// token hands out the registered ID token only to a client that sent its credentials in the form
// and whose secret is a JWT signed with the client's key, as Apple's token endpoint requires.
func (p *postingProvider) token(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	if _, _, basic := r.BasicAuth(); basic {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"invalid_client"}`))
		return
	}
	secret := r.PostForm.Get("client_secret")
	p.mu.Lock()
	p.secrets = append(p.secrets, secret)
	issued, ok := p.codes[r.PostForm.Get("code")]
	delete(p.codes, r.PostForm.Get("code"))
	p.mu.Unlock()
	signed, err := jwt.ParseSigned(secret, []jose.SignatureAlgorithm{jose.ES256})
	var c jwt.Claims
	if err == nil {
		err = signed.Claims(&p.key.PublicKey, &c)
	}
	// A code issued without a challenge takes no verifier, as one issued with it needs its own.
	verifier := r.PostForm.Get("code_verifier")
	p.mu.Lock()
	p.verifierSent = p.verifierSent || verifier != ""
	p.mu.Unlock()
	sum := sha256.Sum256([]byte(verifier))
	pkce := issued.challenge == "" && verifier == "" ||
		issued.challenge != "" && base64.RawURLEncoding.EncodeToString(sum[:]) == issued.challenge
	if err != nil || !ok || r.PostForm.Get("client_id") != "services-id" || !pkce {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid_client"}`))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"access_token": "opaque", "token_type": "Bearer", "expires_in": 3600,
		"id_token": p.sign(issued.claims),
	})
}

// provider is the configuration a deployment gives this provider: a further one, signing its
// client secret, returned to by a form POST, asking for no profile scope.
func (p *postingProvider) provider() Provider {
	return Provider{ID: "posting", Issuer: p.issuer(), ClientID: "services-id", SigningKey: p.key,
		SigningKeyID: "KEY1234567", SigningTeamID: "TEAM123456", ResponseMode: ResponseModeFormPost,
		Scopes: []string{"openid", "email"}}
}

// post sends the browser's form POST to the callback, as the provider's page does.
func (b *browser) post(handler func(http.ResponseWriter, *http.Request), target string, form url.Values) *http.Response {
	r := httptest.NewRequest("POST", target, strings.NewReader(form.Encode()))
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	r.Host = "taskfest.example.com"
	for _, c := range b.cookies {
		r.AddCookie(c)
	}
	return b.do(handler, r)
}

func postingService(t *testing.T) (*Service, *postingProvider) {
	t.Helper()
	main, posting := newFakeProvider(t), newPostingProvider(t)
	s, _ := serviceFor(main, posting.provider())
	s.cfg.SecureCookies = true
	return s, posting
}

func postCallback(s *Service, b *browser, form url.Values) *http.Response {
	return b.post(func(w http.ResponseWriter, r *http.Request) { s.Callback(w, r, "posting") },
		MainCallbackPath+"/posting", form)
}

func TestAFormPostProviderIsAskedToPostBackWithItsOwnScopes(t *testing.T) {
	s, _ := postingService(t)
	b := newBrowser()

	asked := startSignIn(t, s, b, "posting")

	if asked.Get("response_mode") != "form_post" || asked.Get("scope") != "openid email" ||
		asked.Get("client_id") != "services-id" || asked.Get("nonce") == "" {
		t.Errorf("asked the provider %v", asked)
	}
}

func TestAFormPostProvidersSignInCookieIsSentOnTheCrossSitePost(t *testing.T) {
	s, _ := postingService(t)
	b := newBrowser()

	startSignIn(t, s, b, "posting")

	c := b.cookies[SignInCookie]
	if c == nil || c.SameSite != http.SameSiteNoneMode || !c.Secure || !c.HttpOnly ||
		c.MaxAge != int(SignInLifetime.Seconds()) {
		t.Errorf("sign-in cookie %+v", c)
	}
}

func TestAFormPostProvidersSignInCookieStaysLaxWithoutSecureCookies(t *testing.T) {
	// SameSite=None without Secure is refused by browsers; plain HTTP stays as it was.
	s, _ := postingService(t)
	s.cfg.SecureCookies = false
	b := newBrowser()

	startSignIn(t, s, b, "posting")

	if c := b.cookies[SignInCookie]; c == nil || c.SameSite != http.SameSiteLaxMode {
		t.Errorf("sign-in cookie %+v", c)
	}
}

func TestAnyOtherProvidersSignInCookieStaysLax(t *testing.T) {
	s, _ := postingService(t)
	b := newBrowser()

	startSignIn(t, s, b, "")

	if c := b.cookies[SignInCookie]; c == nil || c.SameSite != http.SameSiteLaxMode {
		t.Errorf("sign-in cookie %+v", c)
	}
}

func TestAFormPostProviderSignsInByPostWithASignedClientSecret(t *testing.T) {
	s, posting := postingService(t)
	b := newBrowser()
	asked := startSignIn(t, s, b, "posting")
	// As Apple's: no name or picture, email_verified as a string, and is_private_email.
	posting.issue("the-code", asked.Get("code_challenge"), map[string]any{
		"aud": "services-id", "nonce": asked.Get("nonce"), "name": nil,
		"email": "relay@privaterelay.example.com", "email_verified": "true", "is_private_email": "true",
	})
	before := time.Now()

	res := postCallback(s, b, url.Values{"code": {"the-code"}, "state": {asked.Get("state")},
		"user": {`{"name":{"firstName":"Ignored","lastName":"Name"}}`}})

	if res.StatusCode != http.StatusSeeOther || res.Header.Get("Location") != "/" {
		t.Fatalf("callback answered %d to %q", res.StatusCode, res.Header.Get("Location"))
	}
	if c := b.cookies[SessionCookie]; c == nil || c.SameSite != http.SameSiteLaxMode {
		t.Fatalf("session cookie %+v", c)
	}
	if _, left := b.cookies[SignInCookie]; left {
		t.Error("the sign-in cookie outlived the sign-in")
	}
	id, ok := s.Identify(b.request("GET", "/api/auth/me"))
	if !ok || id.Email != "relay@privaterelay.example.com" || id.Name != "" || id.Provider != "posting" {
		t.Errorf("signed in as %+v, %v", id, ok)
	}
	if len(posting.secrets) != 1 {
		t.Fatalf("sent %d client secrets", len(posting.secrets))
	}
	checkSignedSecret(t, posting, posting.secrets[0], before)
}

// checkSignedSecret checks a client secret against Apple's documented form: ES256 with the key's
// id in the header; issued by the team, about the client, for the provider; at most six months.
func checkSignedSecret(t *testing.T, posting *postingProvider, secret string, before time.Time) {
	t.Helper()
	signed, err := jwt.ParseSigned(secret, []jose.SignatureAlgorithm{jose.ES256})
	if err != nil {
		t.Fatal(err)
	}
	if h := signed.Headers[0]; h.KeyID != "KEY1234567" || h.Algorithm != "ES256" {
		t.Errorf("header %+v", h)
	}
	var c jwt.Claims
	if err := signed.Claims(&posting.key.PublicKey, &c); err != nil {
		t.Fatal(err)
	}
	if c.Issuer != "TEAM123456" || c.Subject != "services-id" ||
		len(c.Audience) != 1 || c.Audience[0] != posting.issuer() {
		t.Errorf("claims %+v", c)
	}
	iat, exp := c.IssuedAt.Time(), c.Expiry.Time()
	if iat.Before(before.Add(-time.Second)) || !exp.After(iat) || exp.Sub(iat) > 15777000*time.Second {
		t.Errorf("issued %v, expires %v", iat, exp)
	}
}

func TestAFormPostProvidersCancelledSignInGoesBackToTheApp(t *testing.T) {
	s, _ := postingService(t)
	b := newBrowser()
	asked := startSignIn(t, s, b, "posting")

	res := postCallback(s, b, url.Values{"error": {"user_cancelled_authorize"}, "state": {asked.Get("state")}})

	refusedBackToTheApp(t, res, b)
}

func TestAFormPostFromAnotherBrowserIsRefused(t *testing.T) {
	s, posting := postingService(t)
	asked := startSignIn(t, s, newBrowser(), "posting")
	posting.issue("the-code", asked.Get("code_challenge"), map[string]any{"aud": "services-id", "nonce": asked.Get("nonce")})

	other := newBrowser()
	res := postCallback(s, other, url.Values{"code": {"the-code"}, "state": {asked.Get("state")}})

	refusedBackToTheApp(t, res, other)
}

func TestACallbackAnswersOnlyTheWayItsProviderReturns(t *testing.T) {
	s, posting := postingService(t)

	b := newBrowser()
	asked := startSignIn(t, s, b, "posting")
	posting.issue("the-code", asked.Get("code_challenge"), map[string]any{"aud": "services-id", "nonce": asked.Get("nonce")})
	res := b.do(func(w http.ResponseWriter, r *http.Request) { s.Callback(w, r, "posting") },
		b.request("GET", MainCallbackPath+"/posting?"+url.Values{"code": {"the-code"}, "state": {asked.Get("state")}}.Encode()))
	if res.StatusCode != http.StatusMethodNotAllowed || res.Header.Get("Allow") != "POST" {
		t.Errorf("a form_post provider's callback by GET: %d, Allow %q", res.StatusCode, res.Header.Get("Allow"))
	}
	if _, signedIn := b.cookies[SessionCookie]; signedIn {
		t.Error("signed in by GET")
	}

	b = newBrowser()
	asked = startSignIn(t, s, b, "")
	res = b.post(func(w http.ResponseWriter, r *http.Request) { s.Callback(w, r, "") }, MainCallbackPath,
		url.Values{"code": {"c"}, "state": {asked.Get("state")}})
	if res.StatusCode != http.StatusMethodNotAllowed || res.Header.Get("Allow") != "GET" {
		t.Errorf("another provider's callback by POST: %d, Allow %q", res.StatusCode, res.Header.Get("Allow"))
	}
}

func TestAPostedCallbackReadsTheFormNotTheQuery(t *testing.T) {
	s, posting := postingService(t)
	b := newBrowser()
	asked := startSignIn(t, s, b, "posting")
	posting.issue("the-code", asked.Get("code_challenge"), map[string]any{"aud": "services-id", "nonce": asked.Get("nonce")})

	res := b.post(func(w http.ResponseWriter, r *http.Request) { s.Callback(w, r, "posting") },
		MainCallbackPath+"/posting?"+url.Values{"code": {"the-code"}, "state": {asked.Get("state")}}.Encode(), url.Values{})

	refusedBackToTheApp(t, res, b)
}

func TestASignedClientSecretIsFreshForEachExchange(t *testing.T) {
	s, posting := postingService(t)
	for i := range 2 {
		b := newBrowser()
		asked := startSignIn(t, s, b, "posting")
		posting.issue("c", asked.Get("code_challenge"), map[string]any{"aud": "services-id", "nonce": asked.Get("nonce")})
		s.now = func() time.Time { return time.Now().Add(time.Duration(i) * time.Hour) }
		postCallback(s, b, url.Values{"code": {"c"}, "state": {asked.Get("state")}})
	}

	if len(posting.secrets) != 2 || posting.secrets[0] == posting.secrets[1] {
		t.Errorf("secrets %v", posting.secrets)
	}
}

// pemOf is the key as Apple's .p8 file holds it: PKCS#8 in PEM.
func pemOf(t *testing.T, key any) string {
	t.Helper()
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
}
