package auth

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

// browser carries cookies from one response to the next request, as a browser does.
type browser struct{ cookies map[string]*http.Cookie }

func newBrowser() *browser { return &browser{cookies: map[string]*http.Cookie{}} }

func (b *browser) request(method, target string) *http.Request {
	r := httptest.NewRequest(method, target, nil)
	r.Host = "taskfest.example.com"
	for _, c := range b.cookies {
		r.AddCookie(c)
	}
	return r
}

func (b *browser) keep(res *http.Response) {
	for _, c := range res.Cookies() {
		if c.MaxAge < 0 {
			delete(b.cookies, c.Name)
		} else {
			b.cookies[c.Name] = c
		}
	}
}

func (b *browser) do(handler func(http.ResponseWriter, *http.Request), r *http.Request) *http.Response {
	rec := httptest.NewRecorder()
	handler(rec, r)
	res := rec.Result()
	b.keep(res)
	return res
}

// startSignIn sends the browser to /api/auth/login and returns where the provider was asked to
// send it back, with the state, nonce and PKCE challenge it was given.
func startSignIn(t *testing.T, s *Service, b *browser, id string) url.Values {
	t.Helper()
	res := b.do(func(w http.ResponseWriter, r *http.Request) { s.Login(w, r, id) }, b.request("GET", MainLoginPath))
	if res.StatusCode != http.StatusFound {
		t.Fatalf("login answered %d", res.StatusCode)
	}
	to, err := url.Parse(res.Header.Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	return to.Query()
}

func callback(s *Service, b *browser, id string, query url.Values) *http.Response {
	return b.do(func(w http.ResponseWriter, r *http.Request) { s.Callback(w, r, id) },
		b.request("GET", MainCallbackPath+"?"+query.Encode()))
}

// signIn runs the whole sign-in with these claims and returns the callback's response.
func signIn(t *testing.T, s *Service, f *fakeProvider, b *browser, claims map[string]any) *http.Response {
	t.Helper()
	asked := startSignIn(t, s, b, "")
	if claims == nil {
		claims = map[string]any{}
	}
	if _, set := claims["nonce"]; !set {
		claims["nonce"] = asked.Get("nonce")
	}
	f.issue("the-code", asked.Get("code_challenge"), claims)
	return callback(s, b, "", url.Values{"code": {"the-code"}, "state": {asked.Get("state")}})
}

func TestSignInStartsTheCodeFlowWithPKCEAndANonce(t *testing.T) {
	f := newFakeProvider(t)
	s, _ := serviceFor(f)
	b := newBrowser()

	asked := startSignIn(t, s, b, "")

	if asked.Get("redirect_uri") != "http://taskfest.example.com/api/auth/callback" ||
		asked.Get("client_id") != "web-client" || asked.Get("code_challenge_method") != "S256" ||
		asked.Get("nonce") == "" || asked.Get("state") == "" || asked.Get("scope") != "openid email profile" {
		t.Errorf("asked the provider %v", asked)
	}
	if c := b.cookies[SignInCookie]; c == nil || c.Value != asked.Get("state") || !c.HttpOnly {
		t.Errorf("sign-in cookie %+v", c)
	}
}

func TestTheRedirectURIUsesThePublicOriginWhereOneIsSet(t *testing.T) {
	f := newFakeProvider(t)
	s, _ := serviceFor(f)
	s.cfg.PublicOrigin = "https://taskfest.cloud.example.com"

	asked := startSignIn(t, s, newBrowser(), "")

	if asked.Get("redirect_uri") != "https://taskfest.cloud.example.com/api/auth/callback" {
		t.Errorf("redirect_uri %q", asked.Get("redirect_uri"))
	}
}

func TestACompletedSignInIsASessionAndBackToTheApp(t *testing.T) {
	f := newFakeProvider(t)
	s, store := serviceFor(f)
	b := newBrowser()

	res := signIn(t, s, f, b, nil)

	if res.StatusCode != http.StatusSeeOther || res.Header.Get("Location") != "/" {
		t.Fatalf("callback answered %d to %q", res.StatusCode, res.Header.Get("Location"))
	}
	session := b.cookies[SessionCookie]
	if session == nil || !session.HttpOnly || session.SameSite != http.SameSiteLaxMode ||
		session.MaxAge != int(AbsoluteLifetime.Seconds()) {
		t.Fatalf("session cookie %+v", session)
	}
	if _, left := b.cookies[SignInCookie]; left {
		t.Error("the sign-in cookie outlived the sign-in")
	}
	if _, stored := store.sessions[session.Value]; stored {
		t.Error("the session is stored under the cookie's value itself, not its hash")
	}
	id, ok := s.Identify(b.request("GET", "/api/auth/me"))
	if !ok || id.Email != "person@example.com" || id.Name != "Person Example" {
		t.Errorf("signed in as %+v, %v", id, ok)
	}
}

func TestACallbackFromAnotherBrowserIsRefused(t *testing.T) {
	f := newFakeProvider(t)
	s, _ := serviceFor(f)
	asked := startSignIn(t, s, newBrowser(), "")
	f.issue("the-code", asked.Get("code_challenge"), map[string]any{"nonce": asked.Get("nonce")})

	res := callback(s, newBrowser(), "", url.Values{"code": {"the-code"}, "state": {asked.Get("state")}})

	if res.StatusCode != http.StatusUnauthorized {
		t.Errorf("got %d; want 401", res.StatusCode)
	}
}

func TestACallbackWorksOnce(t *testing.T) {
	f := newFakeProvider(t)
	s, _ := serviceFor(f)
	b := newBrowser()
	asked := startSignIn(t, s, b, "")
	state := b.cookies[SignInCookie]
	f.issue("the-code", asked.Get("code_challenge"), map[string]any{"nonce": asked.Get("nonce")})
	callback(s, b, "", url.Values{"code": {"the-code"}, "state": {asked.Get("state")}})
	b.cookies[SignInCookie] = state
	f.issue("the-code", asked.Get("code_challenge"), map[string]any{"nonce": asked.Get("nonce")})

	res := callback(s, b, "", url.Values{"code": {"the-code"}, "state": {asked.Get("state")}})

	if res.StatusCode != http.StatusUnauthorized {
		t.Errorf("a replayed callback got %d; want 401", res.StatusCode)
	}
}

func TestASignInIsRefusedForAnotherNonceAnUnverifiedEmailOrAProviderError(t *testing.T) {
	f := newFakeProvider(t)
	s, _ := serviceFor(f)

	for name, claims := range map[string]map[string]any{
		"another nonce":    {"nonce": "not-this-sign-ins"},
		"unverified email": {"email_verified": false},
		"another audience": {"aud": "ios-client"},
		"an access token":  {"typ": "Bearer"},
	} {
		b := newBrowser()
		if res := signIn(t, s, f, b, claims); res.StatusCode != http.StatusUnauthorized {
			t.Errorf("%s: got %d; want 401", name, res.StatusCode)
		}
		if _, ok := b.cookies[SessionCookie]; ok {
			t.Errorf("%s: a session cookie was set", name)
		}
	}
	b := newBrowser()
	asked := startSignIn(t, s, b, "")
	if res := callback(s, b, "", url.Values{"error": {"access_denied"}, "state": {asked.Get("state")}}); res.StatusCode != http.StatusUnauthorized {
		t.Errorf("a provider's error got %d", res.StatusCode)
	}
}

func TestSigningInWhileSignedInGoesBackToTheApp(t *testing.T) {
	f := newFakeProvider(t)
	s, _ := serviceFor(f)
	b := newBrowser()
	signIn(t, s, f, b, nil)

	res := b.do(func(w http.ResponseWriter, r *http.Request) { s.Login(w, r, "") }, b.request("GET", MainLoginPath))

	if res.StatusCode != http.StatusSeeOther || res.Header.Get("Location") != "/" {
		t.Errorf("got %d to %q", res.StatusCode, res.Header.Get("Location"))
	}
}

func TestASessionEndsAfterEightIdleHours(t *testing.T) {
	f := newFakeProvider(t)
	s, store := serviceFor(f)
	b := newBrowser()
	signIn(t, s, f, b, nil)
	start := time.Now()

	s.now = func() time.Time { return start.Add(7 * time.Hour) }
	if _, ok := s.Identify(b.request("GET", "/")); !ok {
		t.Fatal("ended after seven hours")
	}
	s.now = func() time.Time { return start.Add(7*time.Hour + IdleLifetime + time.Minute) }
	if _, ok := s.Identify(b.request("GET", "/")); ok {
		t.Error("lasted beyond eight idle hours")
	}
	if len(store.sessions) != 0 {
		t.Error("the ended session is still stored")
	}
}

func TestASessionInUseEndsSevenDaysAfterSignIn(t *testing.T) {
	f := newFakeProvider(t)
	s, _ := serviceFor(f)
	b := newBrowser()
	signIn(t, s, f, b, nil)
	start := time.Now()

	for h := time.Duration(0); h < AbsoluteLifetime-time.Hour; h += 4 * time.Hour {
		s.now = func() time.Time { return start.Add(h) }
		if _, ok := s.Identify(b.request("GET", "/")); !ok {
			t.Fatalf("ended after %v in use", h)
		}
	}
	s.now = func() time.Time { return start.Add(AbsoluteLifetime + time.Minute) }
	if _, ok := s.Identify(b.request("GET", "/")); ok {
		t.Error("lasted beyond seven days")
	}
}

func TestABusySessionIsNotWrittenOnEveryRequest(t *testing.T) {
	f := newFakeProvider(t)
	s, store := serviceFor(f)
	b := newBrowser()
	signIn(t, s, f, b, nil)
	key := hash(b.cookies[SessionCookie].Value)
	signedIn := store.sessions[key].LastSeen

	s.now = func() time.Time { return signedIn.Add(time.Minute) }
	s.Identify(b.request("GET", "/"))
	if !store.sessions[key].LastSeen.Equal(signedIn) {
		t.Error("recorded a request a minute after the last")
	}
	s.now = func() time.Time { return signedIn.Add(touchAfter + time.Minute) }
	s.Identify(b.request("GET", "/"))
	if !store.sessions[key].LastSeen.Equal(signedIn.Add(touchAfter + time.Minute)) {
		t.Error("did not record a request after the touch interval")
	}
	if want := signedIn.Add(touchAfter + time.Minute + IdleLifetime); !store.expires[key].Equal(want) {
		t.Errorf("expires %v; want %v", store.expires[key], want)
	}
}

func TestSignOutEndsTheSessionOnTheServerToo(t *testing.T) {
	f := newFakeProvider(t)
	s, _ := serviceFor(f)
	b := newBrowser()
	signIn(t, s, f, b, nil)
	copied := *b.cookies[SessionCookie]
	b.cookies["q_session_chunk_1"] = &http.Cookie{Name: "q_session_chunk_1", Value: "old"}

	res := b.do(s.Logout, b.request("GET", "/api/auth/logout"))

	if res.StatusCode != http.StatusSeeOther || res.Header.Get("Location") != "/" {
		t.Errorf("got %d to %q", res.StatusCode, res.Header.Get("Location"))
	}
	if len(b.cookies) != 0 {
		t.Errorf("cookies left: %v", b.cookies)
	}
	stolen := newBrowser()
	stolen.cookies[SessionCookie] = &copied
	if _, ok := s.Identify(stolen.request("GET", "/")); ok {
		t.Error("a copy of the cookie still signs in after sign-out")
	}
}

func TestOnlyAUsableProvidersPathsAnswer(t *testing.T) {
	f := newFakeProvider(t)
	s, _ := serviceFor(f, Provider{ID: "cognito", Issuer: f.issuer(), ClientID: "web-client", ClientSecret: "web-secret"},
		Provider{ID: "unconfigured", Issuer: f.issuer()})

	for id, want := range map[string]int{"cognito": http.StatusFound, "main": http.StatusNotFound,
		"unconfigured": http.StatusNotFound, "nobody": http.StatusNotFound} {
		res := newBrowser().do(func(w http.ResponseWriter, r *http.Request) { s.Login(w, r, id) },
			httptest.NewRequest("GET", MainLoginPath+"/"+id, nil))
		if res.StatusCode != want {
			t.Errorf("%s: got %d; want %d", id, res.StatusCode, want)
		}
	}
	s.cfg.Enabled = false
	res := newBrowser().do(func(w http.ResponseWriter, r *http.Request) { s.Login(w, r, "") },
		httptest.NewRequest("GET", MainLoginPath, nil))
	if res.StatusCode != http.StatusNotFound {
		t.Errorf("switched off: got %d", res.StatusCode)
	}
}

func TestAFurtherProviderSignsInAtItsOwnCallback(t *testing.T) {
	main, further := newFakeProvider(t), newFakeProvider(t)
	s, _ := serviceFor(main, Provider{ID: "cognito", Issuer: further.issuer(), ClientID: "web-client",
		ClientSecret: "web-secret"})
	b := newBrowser()

	asked := startSignIn(t, s, b, "cognito")
	further.issue("c", asked.Get("code_challenge"), map[string]any{"nonce": asked.Get("nonce")})
	if !strings.HasSuffix(asked.Get("redirect_uri"), "/api/auth/callback/cognito") {
		t.Errorf("redirect_uri %q", asked.Get("redirect_uri"))
	}
	if res := callback(s, b, "", url.Values{"code": {"c"}, "state": {asked.Get("state")}}); res.StatusCode != http.StatusUnauthorized {
		t.Errorf("the main provider's callback finished another's sign-in: %d", res.StatusCode)
	}
}
