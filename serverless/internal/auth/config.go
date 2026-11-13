// Package auth is sign-in: the providers a deployment offers, the ID tokens the apps send, and the
// website's sign-in through the backend with a session kept in DynamoDB (#549). It follows the
// Quarkus backend (doc/authentication.md) except where Gunnar decided otherwise on #549: the
// session is stored, not carried in an encrypted cookie, and is never renewed with the provider.
//
// It imports no AWS package: the sessions' storage is an interface, which internal/store
// implements.
package auth

import (
	"fmt"
	"slices"
	"strings"
)

// MainLoginPath is where sign-in with a deployment's main provider starts; every other provider
// starts at MainLoginPath + "/" + its id. The callbacks follow the same pattern.
const (
	MainLoginPath    = "/api/auth/login"
	MainCallbackPath = "/api/auth/callback"
)

// maxProviderIDLength bounds a provider id in a path, as the Quarkus backend does.
const maxProviderIDLength = 64

// Provider is one OpenID Connect provider a deployment offers.
type Provider struct {
	// ID names the provider in paths and in the provider list, such as "google".
	ID string
	// Label is what the sign-in button says.
	Label string
	// Issuer is the provider's issuer URL, exactly as its ID tokens' iss claim spells it.
	Issuer string
	// DiscoveryURL is where the provider's metadata is fetched when that is not Issuer: in the
	// local stacks (#556), Keycloak's issuer is the browser's localhost:8082, which a container
	// cannot reach, as Quarkus's auth-server-url is set apart from it. Empty means Issuer.
	DiscoveryURL string
	// ClientID and ClientSecret are the backend's client at the provider. A provider without
	// both is listed but not usable.
	ClientID, ClientSecret string
	// Audiences are the client ids a bearer ID token may be issued to; empty means ClientID
	// alone. An app with a client of its own (iOS at Google, the app's Cognito client) adds it.
	Audiences []string
	// Main is true for the provider that signs in at MainLoginPath.
	Main bool
}

// Usable is whether sign-in with the provider can work: it has a client id and a secret.
func (p Provider) Usable() bool {
	return strings.TrimSpace(p.ClientID) != "" && strings.TrimSpace(p.ClientSecret) != ""
}

// LoginPath is where sign-in with the provider starts.
func (p Provider) LoginPath() string {
	if p.Main {
		return MainLoginPath
	}
	return MainLoginPath + "/" + p.ID
}

// CallbackPath is where the provider sends the browser back to.
func (p Provider) CallbackPath() string {
	if p.Main {
		return MainCallbackPath
	}
	return MainCallbackPath + "/" + p.ID
}

// audiences is who a bearer ID token may have been issued to.
func (p Provider) audiences() []string {
	if len(p.Audiences) > 0 {
		return p.Audiences
	}
	return []string{p.ClientID}
}

// Config is a deployment's sign-in.
type Config struct {
	// Enabled is false where sign-in is switched off: providers are listed but none is usable.
	Enabled bool
	// Providers are those the deployment offers, at most one of them Main.
	Providers []Provider
	// PostLoginRedirect is where the browser goes after signing in or out, "/" by default.
	PostLoginRedirect string
	// PublicOrigin is the site's origin, such as https://taskfest.cloud.hilling.de, for the
	// redirect URI. Empty means the request's own Host, which is right locally; behind
	// CloudFront and API Gateway the Host is API Gateway's, so the deployment sets it.
	PublicOrigin string
	// SecureCookies sets Secure on every cookie: everywhere but plain-HTTP local development.
	SecureCookies bool
}

// LoadConfig reads the sign-in configuration from the environment:
//
//	TASKFEST_AUTH_ENABLED            "true" to switch sign-in on
//	TASKFEST_AUTH_PROVIDERS          the provider ids, comma-separated, the main one first
//	TASKFEST_OIDC_<ID>_LABEL         the button's label
//	TASKFEST_OIDC_<ID>_ISSUER        the issuer URL
//	TASKFEST_OIDC_<ID>_DISCOVERY_URL where its metadata is, when not at the issuer (local stacks)
//	TASKFEST_OIDC_<ID>_CLIENT_ID     the backend's client id
//	TASKFEST_OIDC_<ID>_CLIENT_SECRET its secret
//	TASKFEST_OIDC_<ID>_AUDIENCES     further client ids a bearer token may name, comma-separated
//	TASKFEST_AUTH_POST_LOGIN_REDIRECT_URI, TASKFEST_PUBLIC_ORIGIN, TASKFEST_COOKIE_SECURE
//
// A provider the deployment switched off is simply not in TASKFEST_AUTH_PROVIDERS, so it is not
// listed, as with the Quarkus backend.
func LoadConfig(getenv func(string) string) (Config, error) {
	c := Config{
		Enabled:           strings.EqualFold(getenv("TASKFEST_AUTH_ENABLED"), "true"),
		PostLoginRedirect: getenv("TASKFEST_AUTH_POST_LOGIN_REDIRECT_URI"),
		PublicOrigin:      strings.TrimSuffix(getenv("TASKFEST_PUBLIC_ORIGIN"), "/"),
		SecureCookies:     !strings.EqualFold(getenv("TASKFEST_COOKIE_SECURE"), "false"),
	}
	if c.PostLoginRedirect == "" {
		c.PostLoginRedirect = "/"
	}
	keys := map[string]string{}
	for i, id := range list(getenv("TASKFEST_AUTH_PROVIDERS")) {
		if len(id) > maxProviderIDLength || strings.ContainsAny(id, "/?#") {
			return Config{}, fmt.Errorf("provider id %q is not usable in a path", id)
		}
		key := "TASKFEST_OIDC_" + strings.ToUpper(strings.ReplaceAll(id, "-", "_")) + "_"
		if other, taken := keys[key]; taken {
			return Config{}, fmt.Errorf("providers %q and %q would both be configured by %s*", other, id, key)
		}
		keys[key] = id
		p := Provider{
			ID: id, Label: getenv(key + "LABEL"), Issuer: getenv(key + "ISSUER"),
			DiscoveryURL: getenv(key + "DISCOVERY_URL"),
			ClientID:     getenv(key + "CLIENT_ID"), ClientSecret: getenv(key + "CLIENT_SECRET"),
			Audiences: list(getenv(key + "AUDIENCES")), Main: i == 0,
		}
		if p.Label == "" {
			p.Label = id
		}
		if p.Issuer == "" {
			return Config{}, fmt.Errorf("provider %q has no issuer (%sISSUER)", id, key)
		}
		if len(p.Audiences) > 0 && !slices.Contains(p.Audiences, p.ClientID) {
			// The website's own client issues ID tokens too: Android's Credential Manager uses it.
			p.Audiences = append([]string{p.ClientID}, p.Audiences...)
		}
		c.Providers = append(c.Providers, p)
	}
	return c, nil
}

func list(s string) []string {
	var out []string
	for _, v := range strings.Split(s, ",") {
		if v = strings.TrimSpace(v); v != "" {
			out = append(out, v)
		}
	}
	return out
}

// provider returns the provider with this id.
func (c Config) provider(id string) (Provider, bool) {
	for _, p := range c.Providers {
		if p.ID == id {
			return p, true
		}
	}
	return Provider{}, false
}

// main returns the deployment's main provider.
func (c Config) main() (Provider, bool) {
	for _, p := range c.Providers {
		if p.Main {
			return p, true
		}
	}
	return Provider{}, false
}

// ListedProvider is one entry of the provider list the signed-out page shows.
type ListedProvider struct {
	ID, Label, Issuer string
	// Available is whether its button can be used; LoginURL is set only then.
	Available bool
	LoginURL  string
}

// List is the provider list, ordered by id as the Quarkus backend orders it.
func (c Config) List() []ListedProvider {
	out := make([]ListedProvider, 0, len(c.Providers))
	for _, p := range c.Providers {
		l := ListedProvider{ID: p.ID, Label: p.Label, Issuer: p.Issuer, Available: c.Enabled && p.Usable()}
		if l.Available {
			l.LoginURL = p.LoginPath()
		}
		out = append(out, l)
	}
	slices.SortFunc(out, func(a, b ListedProvider) int { return strings.Compare(a.ID, b.ID) })
	return out
}
