package io.github.guhilling.todo.api;

import io.github.guhilling.todo.api.AuthProviderResource.AuthProviderResponse;
import io.github.guhilling.todo.api.AuthProviderResource.AuthProvidersConfig;
import io.github.guhilling.todo.api.AuthProviderResource.AuthProvidersResponse;
import io.github.guhilling.todo.api.AuthProviderResource.ProviderConfig;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Pins down when a sign-in card is offered as clickable, one configuration at a time.
 *
 * <p>This is a plain unit test on purpose. The rule it covers -- a provider is usable only
 * when authentication is on <em>and</em> both credentials are non-blank -- is a decision
 * about configuration, not about HTTP or persistence, so feeding the config interface
 * directly covers every combination in milliseconds. {@link AuthProviderResourceTest} boots
 * Quarkus and can therefore only ever check the one combination its profile happens to
 * declare, which is why the disabled-provider case was the only one covered before.</p>
 */
class AuthProviderMappingTest {

    private static final String LOGIN_PATH = "/api/auth/login";
    private static final Optional<String> NOT_CONFIGURED = Optional.empty();

    @Test
    void shouldOfferAProviderThatIsEnabledAndFullyConfigured() {
        AuthProviderResponse google = onlyProvider(enabled(provider("Google", "client", "secret")));

        assertTrue(google.available());
        assertEquals(LOGIN_PATH, google.loginUrl());
        assertEquals("Google", google.label());
    }

    @Test
    void shouldNotOfferAProviderWhoseClientIdIsBlank() {
        AuthProviderResponse google = onlyProvider(enabled(provider("Google", "   ", "secret")));

        assertFalse(google.available());
        assertNull(google.loginUrl());
    }

    @Test
    void shouldNotOfferAProviderWithNoClientSecretAtAll() {
        ProviderConfig withoutSecret =
            new StubProvider("Google", Optional.of("client"), NOT_CONFIGURED, Optional.of("https://issuer"));

        AuthProviderResponse google = onlyProvider(enabled(withoutSecret));

        assertFalse(google.available());
        assertNull(google.loginUrl());
    }

    @Test
    void shouldOfferNothingWhileAuthenticationIsSwitchedOffEvenWithCredentials() {
        AuthProvidersResponse response =
            providersOf(new StubConfig(false, Map.of("google", provider("Google", "client", "secret"))));

        assertFalse(response.enabled());
        assertFalse(response.providers().getFirst().available());
        assertNull(response.providers().getFirst().loginUrl());
    }

    @Test
    void shouldReportAnUnconfiguredIssuerAsEmptyRatherThanNull() {
        ProviderConfig withoutIssuer =
            new StubProvider("Google", Optional.of("client"), Optional.of("secret"), NOT_CONFIGURED);

        assertEquals("", onlyProvider(enabled(withoutIssuer)).issuer());
    }

    @Test
    void shouldOrderProvidersByIdSoTheCardsDoNotMoveBetweenRequests() {
        // A LinkedHashMap in deliberately wrong order: the resource has to sort, and a Map.of
        // would hide a missing sort behind its own unspecified iteration order.
        Map<String, ProviderConfig> outOfOrder = new LinkedHashMap<>();
        outOfOrder.put("keycloak", provider("Keycloak", "client", "secret"));
        outOfOrder.put("google", provider("Google", "client", "secret"));

        AuthProvidersResponse response = providersOf(new StubConfig(true, outOfOrder));

        assertEquals(List.of("google", "keycloak"), response.providers().stream().map(AuthProviderResponse::id).toList());
    }

    private static AuthProvidersResponse providersOf(AuthProvidersConfig config) {
        return new AuthProviderResource(config).providers();
    }

    private static AuthProviderResponse onlyProvider(AuthProvidersConfig config) {
        return providersOf(config).providers().getFirst();
    }

    private static AuthProvidersConfig enabled(ProviderConfig provider) {
        return new StubConfig(true, Map.of("google", provider));
    }

    private static ProviderConfig provider(String label, String clientId, String clientSecret) {
        return new StubProvider(label, Optional.of(clientId), Optional.of(clientSecret), Optional.of("https://issuer"));
    }

    /** Stands in for the {@code todo.auth} config tree without a Quarkus container to bind it. */
    private record StubConfig(boolean enabled, Map<String, ProviderConfig> providers) implements AuthProvidersConfig {
    }

    /** Stands in for one {@code todo.auth.providers.*} entry. */
    private record StubProvider(
        String label,
        Optional<String> clientId,
        Optional<String> clientSecret,
        Optional<String> issuer
    ) implements ProviderConfig {
    }
}
