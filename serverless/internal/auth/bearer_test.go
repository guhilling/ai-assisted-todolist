package auth

import (
	"crypto/rand"
	"crypto/rsa"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/identity"
)

func serviceFor(f *fakeProvider, extra ...Provider) (*Service, *memStore) {
	providers := append([]Provider{{ID: "main", Label: "Main", Issuer: f.issuer(), ClientID: "web-client",
		ClientSecret: "web-secret", Main: true}}, extra...)
	store := newMemStore()
	return New(Config{Enabled: true, Providers: providers, PostLoginRedirect: "/"}, store, &noAvatars{}), store
}

func withBearer(token string) *http.Request {
	r := httptest.NewRequest("GET", "/api/tasks", nil)
	r.Header.Set("Authorization", "Bearer "+token)
	return r
}

func TestABearerIDTokenSignsInItsVerifiedEmail(t *testing.T) {
	f := newFakeProvider(t)
	s, _ := serviceFor(f)

	id, ok := s.Identify(withBearer(f.sign(map[string]any{"picture": "https://example.com/p.jpg"})))

	if !ok || id.Email != "person@example.com" || id.Name != "Person Example" || id.Provider != "main" ||
		id.Picture != "https://example.com/p.jpg" || id.Subject != "subject-1" {
		t.Errorf("got %+v, %v", id, ok)
	}
}

func TestATokenIssuedToAnotherApplicationIsRefused(t *testing.T) {
	f := newFakeProvider(t)
	s, _ := serviceFor(f)

	if id, ok := s.Identify(withBearer(f.sign(map[string]any{"aud": "someone-elses-client"}))); ok {
		t.Errorf("signed in as %+v", id)
	}
}

func TestAnAppsOwnClientIsAnAudienceWhenNamed(t *testing.T) {
	f := newFakeProvider(t)
	s, _ := serviceFor(f)
	s.cfg.Providers[0].Audiences = []string{"web-client", "ios-client"}

	if _, ok := s.Identify(withBearer(f.sign(map[string]any{"aud": "ios-client"}))); !ok {
		t.Error("a token for the named iOS client was refused")
	}
	if _, ok := s.Identify(withBearer(f.sign(map[string]any{"aud": "android-client"}))); ok {
		t.Error("a token for an unnamed client was accepted")
	}
}

func TestTheProviderMustVouchForTheEmail(t *testing.T) {
	f := newFakeProvider(t)
	s, _ := serviceFor(f)

	for _, verified := range []any{false, "false", nil, "yes"} {
		if _, ok := s.Identify(withBearer(f.sign(map[string]any{"email_verified": verified}))); ok {
			t.Errorf("email_verified %v signed in", verified)
		}
	}
	for _, verified := range []any{true, "true", "True"} {
		if _, ok := s.Identify(withBearer(f.sign(map[string]any{"email_verified": verified}))); !ok {
			t.Errorf("email_verified %v was refused", verified)
		}
	}
	if _, ok := s.Identify(withBearer(f.sign(map[string]any{"email": nil}))); ok {
		t.Error("a token without an email signed in")
	}
}

func TestOnlyAnIDTokenIsAWayIn(t *testing.T) {
	f := newFakeProvider(t)
	s, _ := serviceFor(f)

	for _, access := range []map[string]any{{"typ": "Bearer"}, {"token_use": "access"}} {
		if _, ok := s.Identify(withBearer(f.sign(access))); ok {
			t.Errorf("an access token %v signed in", access)
		}
	}
	for _, id := range []map[string]any{{"typ": "ID"}, {"token_use": "id"}} {
		if _, ok := s.Identify(withBearer(f.sign(id))); !ok {
			t.Errorf("an ID token %v was refused", id)
		}
	}
}

func TestAnExpiredForgedOrUnknownTokenIsRefused(t *testing.T) {
	f := newFakeProvider(t)
	s, _ := serviceFor(f)
	other, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}

	for name, token := range map[string]string{
		"expired":        f.sign(map[string]any{"exp": time.Now().Add(-time.Minute).Unix()}),
		"forged":         f.signWith(other, nil),
		"unknown issuer": f.sign(map[string]any{"iss": "https://elsewhere.example.com"}),
		"not a JWT":      "opaque-access-token",
	} {
		if _, ok := s.Identify(withBearer(token)); ok {
			t.Errorf("%s: signed in", name)
		}
	}
}

func TestTheTokensIssuerChoosesTheProvider(t *testing.T) {
	main, further := newFakeProvider(t), newFakeProvider(t)
	s, _ := serviceFor(main, Provider{ID: "cognito", Issuer: further.issuer(), ClientID: "web-client",
		ClientSecret: "web-secret"})

	id, ok := s.Identify(withBearer(further.sign(nil)))

	if !ok || id.Provider != "cognito" {
		t.Errorf("got %+v, %v", id, ok)
	}
}

func TestABearerRequestNeverWaitsForGravatar(t *testing.T) {
	f := newFakeProvider(t)
	s, _ := serviceFor(f)
	avatars := &noAvatars{}
	s.avatars = avatars

	s.Identify(withBearer(f.sign(nil)))

	if avatars.asked != 0 {
		t.Errorf("asked Gravatar %d times on a bearer request", avatars.asked)
	}
}

func TestWithPictureFillsInOnlyAMissingPicture(t *testing.T) {
	f := newFakeProvider(t)
	s, _ := serviceFor(f)
	s.avatars = fixedAvatars("https://gravatar.example.com/x")

	if got := s.WithPicture(t.Context(), identity.Identity{Email: "a@example.com"}); got.Picture != "https://gravatar.example.com/x" {
		t.Errorf("missing: %q", got.Picture)
	}
	if got := s.WithPicture(t.Context(), identity.Identity{Picture: "own"}); got.Picture != "own" {
		t.Errorf("own: %q", got.Picture)
	}
}

func TestProvidersSharingAnIssuerEachAcceptTheirOwnClientsTokens(t *testing.T) {
	f := newFakeProvider(t)
	s, _ := serviceFor(f, Provider{ID: "app", Issuer: f.issuer(), ClientID: "app-client"})

	id, ok := s.Identify(withBearer(f.sign(map[string]any{"aud": "app-client"})))

	if !ok || id.Provider != "app" {
		t.Errorf("got %+v, %v", id, ok)
	}
}

func TestARequestWithAnAuthorizationHeaderIsNeverJudgedByItsCookie(t *testing.T) {
	f := newFakeProvider(t)
	s, store := serviceFor(f)
	now := time.Now()
	_ = store.PutSession(t.Context(), hash("cookie-token"), Session{Created: now, LastSeen: now}, now.Add(time.Hour))
	r := withBearer("not-a-token")
	r.AddCookie(&http.Cookie{Name: SessionCookie, Value: "cookie-token"})

	if _, ok := s.Identify(r); ok {
		t.Error("a bad bearer token fell back to the session cookie")
	}
}

func TestWithSignInSwitchedOffNobodyIsSignedIn(t *testing.T) {
	f := newFakeProvider(t)
	s, _ := serviceFor(f)
	s.cfg.Enabled = false

	if _, ok := s.Identify(withBearer(f.sign(nil))); ok {
		t.Error("signed in with sign-in switched off")
	}
}
