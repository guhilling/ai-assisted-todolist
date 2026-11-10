package auth

import (
	"reflect"
	"testing"
)

func env(values map[string]string) func(string) string {
	return func(key string) string { return values[key] }
}

func TestTheConfigurationComesFromTheEnvironment(t *testing.T) {
	c, err := LoadConfig(env(map[string]string{
		"TASKFEST_AUTH_ENABLED":              "true",
		"TASKFEST_AUTH_PROVIDERS":            "google, cognito",
		"TASKFEST_OIDC_GOOGLE_LABEL":         "Google",
		"TASKFEST_OIDC_GOOGLE_ISSUER":        "https://accounts.google.com",
		"TASKFEST_OIDC_GOOGLE_CLIENT_ID":     "web",
		"TASKFEST_OIDC_GOOGLE_AUDIENCES":     "ios",
		"TASKFEST_OIDC_COGNITO_ISSUER":       "https://cognito.example.com",
		"TASKFEST_PUBLIC_ORIGIN":             "https://taskfest.example.com/",
		"TASKFEST_OIDC_GOOGLE_CLIENT_SECRET": "s",
	}))

	if err != nil {
		t.Fatal(err)
	}
	if !c.Enabled || !c.SecureCookies || c.PostLoginRedirect != "/" || c.PublicOrigin != "https://taskfest.example.com" {
		t.Errorf("got %+v", c)
	}
	google, cognito := c.Providers[0], c.Providers[1]
	if !google.Main || cognito.Main || google.Label != "Google" || cognito.Label != "cognito" {
		t.Errorf("providers %+v", c.Providers)
	}
	if !reflect.DeepEqual(google.Audiences, []string{"web", "ios"}) {
		t.Errorf("an app's audience must come with the website's own: %v", google.Audiences)
	}
	if !google.Usable() || cognito.Usable() {
		t.Errorf("usable: google %v, cognito %v", google.Usable(), cognito.Usable())
	}
}

func TestTheSwitchesReadTrueAndFalseInAnyCase(t *testing.T) {
	c, err := LoadConfig(env(map[string]string{"TASKFEST_AUTH_ENABLED": "TRUE", "TASKFEST_COOKIE_SECURE": "False"}))

	if err != nil || !c.Enabled || c.SecureCookies {
		t.Errorf("got %+v, %v", c, err)
	}
}

func TestAProviderWithoutAnIssuerOrWithAnIdThatIsUnsafeTakenOrCollidingStopsTheStart(t *testing.T) {
	for _, values := range []map[string]string{
		{"TASKFEST_AUTH_PROVIDERS": "google"},
		{"TASKFEST_AUTH_PROVIDERS": "a/b", "TASKFEST_OIDC_A/B_ISSUER": "https://x.example.com"},
		{"TASKFEST_AUTH_PROVIDERS": "google,google", "TASKFEST_OIDC_GOOGLE_ISSUER": "https://x.example.com"},
		{"TASKFEST_AUTH_PROVIDERS": "my-idp,my_idp", "TASKFEST_OIDC_MY_IDP_ISSUER": "https://x.example.com"},
	} {
		if _, err := LoadConfig(env(values)); err == nil {
			t.Errorf("%v: no error", values)
		}
	}
}

func TestTheProviderListIsOrderedAndOffersOnlyUsableProviders(t *testing.T) {
	c := Config{Enabled: true, Providers: []Provider{
		{ID: "google", Label: "Google", Issuer: "https://accounts.google.com", ClientID: "w", ClientSecret: "s", Main: true},
		{ID: "cognito", Label: "Test", Issuer: "https://c.example.com", ClientID: "w", ClientSecret: "s"},
		{ID: "apple", Label: "Apple", Issuer: "https://appleid.apple.com"},
	}}

	got := c.List()

	want := []ListedProvider{
		{ID: "apple", Label: "Apple", Issuer: "https://appleid.apple.com"},
		{ID: "cognito", Label: "Test", Issuer: "https://c.example.com", Available: true, LoginURL: "/api/auth/login/cognito"},
		{ID: "google", Label: "Google", Issuer: "https://accounts.google.com", Available: true, LoginURL: "/api/auth/login"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %+v", got)
	}
	c.Enabled = false
	for _, p := range c.List() {
		if p.Available || p.LoginURL != "" {
			t.Errorf("switched off, %s is offered", p.ID)
		}
	}
}
