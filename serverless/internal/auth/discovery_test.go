package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// metadataServer answers discovery with an issuer of its choosing, as Keycloak does behind the
// local stacks' port mapping: its issuer is the browser's address, not the one a container reaches.
func metadataServer(t *testing.T, issuer string) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"issuer":                 issuer,
			"authorization_endpoint": issuer + "/authorize",
			"token_endpoint":         issuer + "/token",
			"jwks_uri":               issuer + "/keys",
		})
	}))
	t.Cleanup(server.Close)
	return server
}

func TestAProviderIsDiscoveredWhereItSaysWhenThatIsNotItsIssuer(t *testing.T) {
	// The issuer as the browser and the ID tokens name it; the address as a container reaches it.
	const issuer = "http://localhost:8082/realms/taskfest"
	server := metadataServer(t, issuer)

	p, err := (&discovery{}).provider(context.Background(), Provider{ID: "keycloak", Issuer: issuer, DiscoveryURL: server.URL})

	if err != nil {
		t.Fatal(err)
	}
	if p.Endpoint().AuthURL != issuer+"/authorize" {
		t.Errorf("authorization at %q", p.Endpoint().AuthURL)
	}
}

func TestADiscoveryAddressThatAnswersForAnotherIssuerIsRefused(t *testing.T) {
	// Another realm, or a typo in the issuer: refused at discovery, not at every sign-in after it.
	server := metadataServer(t, "http://localhost:8082/realms/other")

	_, err := (&discovery{}).provider(context.Background(),
		Provider{ID: "keycloak", Issuer: "http://localhost:8082/realms/taskfest", DiscoveryURL: server.URL})

	if err == nil {
		t.Error("metadata naming another issuer was taken")
	}
}

func TestWithoutADiscoveryAddressTheIssuerMustAnswerForItself(t *testing.T) {
	server := metadataServer(t, "http://localhost:8082/realms/taskfest")

	_, err := (&discovery{}).provider(context.Background(), Provider{ID: "keycloak", Issuer: server.URL})

	if err == nil {
		t.Error("a provider naming another issuer was taken")
	}
}

func TestTheDiscoveryAddressComesFromTheEnvironment(t *testing.T) {
	c, err := LoadConfig(env(map[string]string{
		"TASKFEST_AUTH_PROVIDERS":              "keycloak",
		"TASKFEST_OIDC_KEYCLOAK_ISSUER":        "http://localhost:8082/realms/taskfest",
		"TASKFEST_OIDC_KEYCLOAK_DISCOVERY_URL": "http://keycloak:8082/realms/taskfest",
	}))

	if err != nil || c.Providers[0].DiscoveryURL != "http://keycloak:8082/realms/taskfest" {
		t.Errorf("got %+v, %v", c.Providers, err)
	}
}
