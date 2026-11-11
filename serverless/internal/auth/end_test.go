package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestEndingTheBrowsersSessionClearsItsCookiesAndTheStoredSessionWithoutARedirect(t *testing.T) {
	f := newFakeProvider(t)
	s, _ := serviceFor(f)
	b := newBrowser()
	signIn(t, s, f, b, nil)
	copied := *b.cookies[SessionCookie]
	b.cookies["q_session"] = &http.Cookie{Name: "q_session", Value: "old"}

	rec := httptest.NewRecorder()
	s.EndSession(rec, b.request("DELETE", "/api/account"))
	res := rec.Result()
	b.keep(res)

	if res.StatusCode != http.StatusOK || res.Header.Get("Location") != "" {
		t.Errorf("got %d to %q; want nothing written but cookies", res.StatusCode, res.Header.Get("Location"))
	}
	if len(b.cookies) != 0 {
		t.Errorf("cookies left: %v", b.cookies)
	}
	stolen := newBrowser()
	stolen.cookies[SessionCookie] = &copied
	if _, ok := s.Identify(stolen.request("GET", "/")); ok {
		t.Error("a copy of the cookie still signs in")
	}
}
