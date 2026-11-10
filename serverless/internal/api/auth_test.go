package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/auth"
	"github.com/guhilling/ai-assisted-todolist/serverless/internal/identity"
)

// fakeSignIn is sign-in for the route tests: a fixed caller, and a record of which provider a
// login or callback was for.
type fakeSignIn struct {
	who      *identity.Identity
	cfg      auth.Config
	provider string
	called   string
}

func (f *fakeSignIn) Identify(*http.Request) (identity.Identity, bool) {
	if f.who == nil {
		return identity.Identity{}, false
	}
	return *f.who, true
}

func (f *fakeSignIn) Login(w http.ResponseWriter, _ *http.Request, provider string) {
	f.called, f.provider = "login", provider
	w.WriteHeader(http.StatusFound)
}

func (f *fakeSignIn) Callback(w http.ResponseWriter, _ *http.Request, provider string) {
	f.called, f.provider = "callback", provider
	w.WriteHeader(http.StatusSeeOther)
}

func (f *fakeSignIn) Logout(w http.ResponseWriter, _ *http.Request) {
	f.called = "logout"
	w.WriteHeader(http.StatusSeeOther)
}

func (f *fakeSignIn) Config() auth.Config { return f.cfg }

func serve(s *Server, method, path string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	Routes(s).ServeHTTP(rec, httptest.NewRequest(method, path, nil))
	return rec
}

func TestMeIsTheSignedInIdentityWithNullsForWhatTheProviderDidNotSay(t *testing.T) {
	c := loadContract(t)
	s := &Server{SignIn: &fakeSignIn{who: &identity.Identity{Email: "person@example.com", Name: "Person"}}}

	rec := serve(s, "GET", "/api/auth/me")

	if rec.Code != http.StatusOK {
		t.Fatalf("got %d", rec.Code)
	}
	c.checkResponse(t, "GET", "/api/auth/me", rec.Code, rec.Body.Bytes())
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["email"] != "person@example.com" || body["name"] != "Person" {
		t.Errorf("got %v", body)
	}
	if picture, present := body["pictureUrl"]; !present || picture != nil {
		t.Errorf("pictureUrl: present %v, %v; want null", present, picture)
	}
}

func TestMeWithoutASignInIs401(t *testing.T) {
	if rec := serve(&Server{SignIn: &fakeSignIn{}}, "GET", "/api/auth/me"); rec.Code != http.StatusUnauthorized {
		t.Errorf("got %d", rec.Code)
	}
}

func TestTheProviderListMatchesTheContract(t *testing.T) {
	c := loadContract(t)
	s := &Server{SignIn: &fakeSignIn{cfg: auth.Config{Enabled: true, Providers: []auth.Provider{
		{ID: "google", Label: "Google", Issuer: "https://accounts.google.com", ClientID: "w", ClientSecret: "s", Main: true},
		{ID: "cognito", Label: "Test", Issuer: "https://c.example.com"},
	}}}}

	rec := serve(s, "GET", "/api/auth/providers")

	c.checkResponse(t, "GET", "/api/auth/providers", rec.Code, rec.Body.Bytes())
	var body struct {
		Enabled   bool
		Providers []map[string]any
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if !body.Enabled || len(body.Providers) != 2 || body.Providers[0]["id"] != "cognito" {
		t.Fatalf("got %+v", body)
	}
	if login, present := body.Providers[0]["loginUrl"]; !present || login != nil {
		t.Errorf("an unusable provider's loginUrl: present %v, %v; want null", present, login)
	}
	if body.Providers[1]["loginUrl"] != "/api/auth/login" {
		t.Errorf("google %v", body.Providers[1])
	}
}

func TestEachSignInPathGoesToItsProvider(t *testing.T) {
	for path, want := range map[string][2]string{
		"/api/auth/login":            {"login", ""},
		"/api/auth/login/cognito":    {"login", "cognito"},
		"/api/auth/callback":         {"callback", ""},
		"/api/auth/callback/cognito": {"callback", "cognito"},
		"/api/auth/logout":           {"logout", ""},
	} {
		f := &fakeSignIn{}
		serve(&Server{SignIn: f}, "GET", path)
		if f.called != want[0] || f.provider != want[1] {
			t.Errorf("%s: %s %q; want %s %q", path, f.called, f.provider, want[0], want[1])
		}
	}
}

func TestAnOverlongProviderIdIsNotFound(t *testing.T) {
	f := &fakeSignIn{}
	long := make([]byte, 65)
	for i := range long {
		long[i] = 'a'
	}

	rec := serve(&Server{SignIn: f}, "GET", "/api/auth/login/"+string(long))

	if rec.Code != http.StatusNotFound || f.called != "" {
		t.Errorf("got %d, %q", rec.Code, f.called)
	}
}
