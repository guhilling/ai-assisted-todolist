package auth

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"reflect"
	"testing"
)

func p256(t *testing.T) *ecdsa.PrivateKey {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return key
}

// signing is a provider's settings for a client secret it signs, and a form POST back.
func signing(t *testing.T, key any) map[string]string {
	return map[string]string{
		"TASKFEST_AUTH_ENABLED":                      "true",
		"TASKFEST_AUTH_PROVIDERS":                    "google,apple-web",
		"TASKFEST_OIDC_GOOGLE_ISSUER":                "https://accounts.google.com",
		"TASKFEST_OIDC_APPLE_WEB_ISSUER":             "https://appleid.example.com",
		"TASKFEST_OIDC_APPLE_WEB_CLIENT_ID":          "services-id",
		"TASKFEST_OIDC_APPLE_WEB_SIGNING_KEY_SECRET": pemOf(t, key),
		"TASKFEST_OIDC_APPLE_WEB_SIGNING_KEY_ID":     "KEY1234567",
		"TASKFEST_OIDC_APPLE_WEB_SIGNING_TEAM_ID":    "TEAM123456",
		"TASKFEST_OIDC_APPLE_WEB_RESPONSE_MODE":      "form_post",
		"TASKFEST_OIDC_APPLE_WEB_SCOPES":             "openid, email",
	}
}

func TestAProviderMaySignItsClientSecretAndBeReturnedToByPost(t *testing.T) {
	key := p256(t)

	c, err := LoadConfig(env(signing(t, key)))

	if err != nil {
		t.Fatal(err)
	}
	p := c.Providers[1]
	if p.SigningKey == nil || !p.SigningKey.Equal(key) || p.SigningKeyID != "KEY1234567" ||
		p.SigningTeamID != "TEAM123456" || p.ResponseMode != ResponseModeFormPost {
		t.Errorf("provider %+v", p)
	}
	if !reflect.DeepEqual(p.Scopes, []string{"openid", "email"}) {
		t.Errorf("scopes %v", p.Scopes)
	}
	if !p.Usable() {
		t.Error("a signing key is a client secret: the provider must be usable")
	}
}

func TestAProviderWithoutScopesOrResponseModeAsksAsBefore(t *testing.T) {
	c, err := LoadConfig(env(map[string]string{
		"TASKFEST_AUTH_PROVIDERS": "google", "TASKFEST_OIDC_GOOGLE_ISSUER": "https://accounts.google.com",
	}))

	if err != nil {
		t.Fatal(err)
	}
	p := c.Providers[0]
	if !reflect.DeepEqual(p.scopes(), []string{"openid", "email", "profile"}) || p.ResponseMode != "" {
		t.Errorf("scopes %v, response mode %q", p.scopes(), p.ResponseMode)
	}
}

func TestASigningKeyThatCannotSignOrIsHalfConfiguredStopsTheStart(t *testing.T) {
	rsaKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	p384, err := ecdsa.GenerateKey(elliptic.P384(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	for name, change := range map[string]func(map[string]string){
		"no key id":             func(m map[string]string) { delete(m, "TASKFEST_OIDC_APPLE_WEB_SIGNING_KEY_ID") },
		"no team id":            func(m map[string]string) { delete(m, "TASKFEST_OIDC_APPLE_WEB_SIGNING_TEAM_ID") },
		"ids without a key":     func(m map[string]string) { delete(m, "TASKFEST_OIDC_APPLE_WEB_SIGNING_KEY_SECRET") },
		"not PEM":               func(m map[string]string) { m["TASKFEST_OIDC_APPLE_WEB_SIGNING_KEY_SECRET"] = "secret" },
		"an RSA key":            func(m map[string]string) { m["TASKFEST_OIDC_APPLE_WEB_SIGNING_KEY_SECRET"] = pemOf(t, rsaKey) },
		"a P-384 key":           func(m map[string]string) { m["TASKFEST_OIDC_APPLE_WEB_SIGNING_KEY_SECRET"] = pemOf(t, p384) },
		"a client secret too":   func(m map[string]string) { m["TASKFEST_OIDC_APPLE_WEB_CLIENT_SECRET"] = "s" },
		"another reply":         func(m map[string]string) { m["TASKFEST_OIDC_APPLE_WEB_RESPONSE_MODE"] = "fragment" },
		"form_post by any name": func(m map[string]string) { m["TASKFEST_OIDC_APPLE_WEB_RESPONSE_MODE"] = "post" },
	} {
		values := signing(t, p256(t))
		change(values)
		if _, err := LoadConfig(env(values)); err == nil {
			t.Errorf("%s: no error", name)
		}
	}
}
