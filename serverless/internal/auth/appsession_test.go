package auth

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"
)

// startApp trades an ID token for an app session, as the app does once after a native sign-in.
func startApp(t *testing.T, s *Service, idToken string) AppSession {
	t.Helper()
	started, err := s.StartAppSession(withBearer(idToken))
	if err != nil {
		t.Fatal(err)
	}
	return started
}

func TestAnIDTokenIsTradedForAnAppSessionThatSignsInAsItsPerson(t *testing.T) {
	f := newFakeProvider(t)
	s, store := serviceFor(f)
	now := time.Unix(time.Now().Unix(), 0)
	s.now = func() time.Time { return now }

	started := startApp(t, s, f.sign(map[string]any{"picture": "https://example.com/p.jpg"}))

	if !started.Ends.Equal(now.Add(AppLifetime)) || AppLifetime != 30*24*time.Hour {
		t.Errorf("ends %v; want 30 days after %v", started.Ends, now)
	}
	id, ok := s.Identify(withBearer(started.Token))
	if !ok || id.Email != "person@example.com" || id.Name != "Person Example" || id.Provider != "main" ||
		id.Picture != "https://example.com/p.jpg" || id.Subject != "subject-1" {
		t.Errorf("got %+v, %v", id, ok)
	}
	if _, kept := store.sessions[started.Token]; kept || len(store.sessions) != 1 {
		t.Errorf("the store must hold the token's hash alone: %v", store.sessions)
	}
	if !store.sessions[hash(started.Token)].App {
		t.Error("the stored session is not marked an app's")
	}
}

func TestAnAppSessionTokenCanNeverBeMistakenForAnIDToken(t *testing.T) {
	f := newFakeProvider(t)
	s, _ := serviceFor(f)
	format := regexp.MustCompile(`^taskfest_app_[A-Za-z0-9_-]{43}$`)

	for i := range 20 {
		// A token of its own each time: an ID token trades once (#630).
		token := startApp(t, s, f.sign(map[string]any{"jti": i})).Token
		if !format.MatchString(token) || strings.Contains(token, ".") {
			t.Errorf("token %q is not taskfest_app_ and 43 characters of base64url without a dot", token)
		}
		if _, ok := issuerOf(token); ok {
			t.Errorf("token %q reads as a JWT", token)
		}
	}
	if IsAppSessionToken(f.sign(nil)) {
		t.Error("an ID token reads as an app session token")
	}
}

func TestAnAppSessionLastsThirtyDaysHoweverLittleItIsUsed(t *testing.T) {
	f := newFakeProvider(t)
	s, store := serviceFor(f)
	// Whole seconds, as an app session is stored (#630).
	start := time.Unix(time.Now().Unix(), 0)
	s.now = func() time.Time { return start }
	token := startApp(t, s, f.sign(nil)).Token

	s.now = func() time.Time { return start.Add(29 * 24 * time.Hour) }
	if _, ok := s.Identify(withBearer(token)); !ok {
		t.Error("an app session unused for 29 days has ended; it has no idle limit")
	}
	if got := store.sessions[hash(token)].LastSeen; !got.Equal(start) {
		t.Errorf("a request wrote the app session (last seen %v); nothing about it changes", got)
	}
	s.now = func() time.Time { return start.Add(AppLifetime + time.Second) }
	if _, ok := s.Identify(withBearer(token)); ok {
		t.Error("an app session outlived its 30 days")
	}
	if _, kept := store.sessions[hash(token)]; kept {
		t.Error("an ended app session was left in the store")
	}
}

func TestOnlyAProvidersIDTokenStartsAnAppSession(t *testing.T) {
	f := newFakeProvider(t)
	s, store := serviceFor(f)
	appToken := startApp(t, s, f.sign(nil)).Token
	now := time.Now()
	_ = store.PutSession(t.Context(), hash("cookie-token"), Session{Created: now, LastSeen: now}, now.Add(time.Hour))
	withCookie := httptest.NewRequest("POST", "/api/auth/app-session", nil)
	withCookie.AddCookie(&http.Cookie{Name: SessionCookie, Value: "cookie-token"})

	for name, r := range map[string]*http.Request{
		"no header":            httptest.NewRequest("POST", "/api/auth/app-session", nil),
		"a session cookie":     withCookie,
		"an app session token": withBearer(appToken),
		"another's ID token":   withBearer(f.sign(map[string]any{"aud": "someone-elses-client"})),
		"an unverified email":  withBearer(f.sign(map[string]any{"email_verified": false})),
		"not a token":          withBearer("opaque"),
	} {
		if _, err := s.StartAppSession(r); !errors.Is(err, ErrRefused) {
			t.Errorf("%s: got %v; want it refused", name, err)
		}
	}
	if len(store.sessions) != 2 {
		t.Errorf("a refused request started a session: %d sessions", len(store.sessions))
	}
}

func TestWithSignInSwitchedOffNoAppSessionStartsOrSignsIn(t *testing.T) {
	f := newFakeProvider(t)
	s, _ := serviceFor(f)
	token := startApp(t, s, f.sign(nil)).Token
	s.cfg.Enabled = false

	if _, err := s.StartAppSession(withBearer(f.sign(nil))); !errors.Is(err, ErrRefused) {
		t.Errorf("got %v; want it refused", err)
	}
	if _, ok := s.Identify(withBearer(token)); ok {
		t.Error("an app session signed in with sign-in switched off")
	}
}

func TestAnUnknownAppSessionTokenIsRefused(t *testing.T) {
	f := newFakeProvider(t)
	s, _ := serviceFor(f)

	if _, ok := s.Identify(withBearer(AppSessionPrefix + strings.Repeat("A", 43))); ok {
		t.Error("an unknown app session token signed in")
	}
}

func TestAppAndWebsiteSessionsNeverStandInForEachOther(t *testing.T) {
	f := newFakeProvider(t)
	s, _ := serviceFor(f)
	b := newBrowser()
	signIn(t, s, f, b, nil)
	appToken := startApp(t, s, f.sign(nil)).Token

	asCookie := httptest.NewRequest("GET", "/api/tasks", nil)
	asCookie.AddCookie(&http.Cookie{Name: SessionCookie, Value: appToken})
	if _, ok := s.Identify(asCookie); ok {
		t.Error("an app session token signed the website in as a cookie")
	}
	if _, ok := s.Identify(withBearer(b.cookies[SessionCookie].Value)); ok {
		t.Error("the website's session cookie signed in as a bearer token")
	}
	if _, ok := s.Identify(withBearer(AppSessionPrefix + b.cookies[SessionCookie].Value)); ok {
		t.Error("the website's session signed in under the app session prefix")
	}
}

func TestEndingAnAppSessionSignsTheAppOut(t *testing.T) {
	f := newFakeProvider(t)
	s, store := serviceFor(f)
	token := startApp(t, s, f.sign(nil)).Token
	other := startApp(t, s, f.sign(map[string]any{"jti": "another sign-in"})).Token

	if err := s.EndAppSession(withBearer(token)); err != nil {
		t.Fatal(err)
	}

	if _, ok := s.Identify(withBearer(token)); ok {
		t.Error("an ended app session still signs in")
	}
	if _, ok := s.Identify(withBearer(other)); !ok {
		t.Error("ending one app session ended another")
	}
	if err := s.EndAppSession(withBearer(token)); err != nil {
		t.Errorf("ending an ended app session: %v; want it to succeed", err)
	}
	if len(store.sessions) != 1 {
		t.Errorf("sessions left: %d; want the other one", len(store.sessions))
	}
}

func TestOnlyAnAppSessionTokenCanBeEndedAsOne(t *testing.T) {
	f := newFakeProvider(t)
	s, _ := serviceFor(f)

	for name, r := range map[string]*http.Request{
		"no header":   httptest.NewRequest("DELETE", "/api/auth/app-session", nil),
		"an ID token": withBearer(f.sign(nil)),
		"not a token": withBearer("opaque"),
	} {
		if err := s.EndAppSession(r); !errors.Is(err, ErrRefused) {
			t.Errorf("%s: got %v; want it refused", name, err)
		}
	}
}

func TestEndingTheRequestsSessionEndsItsAppSessionToo(t *testing.T) {
	f := newFakeProvider(t)
	s, _ := serviceFor(f)
	token := startApp(t, s, f.sign(nil)).Token

	s.EndSession(httptest.NewRecorder(), withBearer(token))

	if _, ok := s.Identify(withBearer(token)); ok {
		t.Error("an app session outlived ending the request's session, as deleting the account does")
	}
}
