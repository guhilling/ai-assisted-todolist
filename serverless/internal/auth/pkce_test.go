package auth

import (
	"net/http"
	"net/url"
	"strings"
	"testing"
)

func TestPKCEIsOnUnlessAProviderSaysOtherwise(t *testing.T) {
	// Apple documents no PKCE (#281). If its token endpoint ever refuses the verifier, a setting
	// turns it off for that provider alone, rather than a change to the code and a release.
	settings := signing(t, p256(t))
	c, err := LoadConfig(env(settings))
	if err != nil {
		t.Fatal(err)
	}
	if p, _ := c.provider("apple-web"); p.NoPKCE {
		t.Error("PKCE was off without being asked")
	}

	settings["TASKFEST_OIDC_APPLE_WEB_PKCE"] = "false"
	if c, err = LoadConfig(env(settings)); err != nil {
		t.Fatal(err)
	}
	if p, _ := c.provider("apple-web"); !p.NoPKCE {
		t.Error("PKCE=false left PKCE on")
	}

	settings["TASKFEST_OIDC_APPLE_WEB_PKCE"] = "nope"
	if _, err = LoadConfig(env(settings)); err == nil || !strings.Contains(err.Error(), "PKCE") {
		t.Errorf("an unknown PKCE value started: %v", err)
	}
}

func TestScopesWithoutOpenIDStopTheStart(t *testing.T) {
	// Without openid the provider sends no ID token, and every sign-in would fail after a start
	// that looked fine.
	for _, scopes := range []string{"email", "opneid,email"} {
		settings := signing(t, p256(t))
		settings["TASKFEST_OIDC_APPLE_WEB_SCOPES"] = scopes
		if _, err := LoadConfig(env(settings)); err == nil || !strings.Contains(err.Error(), "openid") {
			t.Errorf("scopes %q started: %v", scopes, err)
		}
	}
}

func TestAProviderWithoutPKCEIsAskedAndExchangedWithoutIt(t *testing.T) {
	main, posting := newFakeProvider(t), newPostingProvider(t)
	p := posting.provider()
	p.NoPKCE = true
	s, _ := serviceFor(main, p)
	s.cfg.SecureCookies = true
	b := newBrowser()

	asked := startSignIn(t, s, b, "posting")
	if asked.Has("code_challenge") || asked.Has("code_challenge_method") {
		t.Fatalf("asked with PKCE: %v", asked)
	}
	posting.issue("the-code", "", map[string]any{"aud": "services-id", "nonce": asked.Get("nonce")})

	res := postCallback(s, b, url.Values{"code": {"the-code"}, "state": {asked.Get("state")}})

	if res.StatusCode != http.StatusSeeOther || posting.verifierSent {
		t.Fatalf("callback answered %d; verifier sent: %v", res.StatusCode, posting.verifierSent)
	}
	// A refused sign-in answers 303 too: only a session proves the exchange went through.
	if id, ok := s.Identify(b.request("GET", "/api/auth/me")); !ok || id.Provider != "posting" {
		t.Errorf("not signed in: %+v, %v", id, ok)
	}
}
