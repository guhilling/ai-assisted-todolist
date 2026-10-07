package de.hilling.taskfest.api;

import de.hilling.taskfest.api.AuthProviderResource.AuthProvidersConfig;
import de.hilling.taskfest.api.AuthProviderResource.AuthProviderResponse;
import de.hilling.taskfest.api.AuthProviderResource.ProviderConfig;
import io.smallrye.config.PropertiesConfigSource;
import io.smallrye.config.SmallRyeConfigBuilder;
import java.util.Map;
import java.util.Optional;
import org.eclipse.microprofile.config.Config;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Where each provider's sign-in starts, as the provider list reports it (#143).
 *
 * <p>A plain unit test, beside {@link AuthProviderMappingTest}: a provider that is a named OIDC
 * tenant signs in at that tenant's {@code tenant-paths}, read from configuration, and every other
 * one at {@code /api/auth/login}. Fed a configuration directly rather than booting Quarkus.</p>
 */
class AuthProviderTenantPathTest {

    @Test
    void shouldSendANamedTenantsProviderToItsOwnPath() {
        assertEquals("/api/auth/login/cognito", loginUrlOf("cognito",
            Map.of("quarkus.oidc.cognito.tenant-paths", "/api/auth/login/cognito")));
    }

    @Test
    void shouldTakeTheFirstOfSeveralPaths() {
        assertEquals("/api/auth/login/cognito", loginUrlOf("cognito",
            Map.of("quarkus.oidc.cognito.tenant-paths", "/api/auth/login/cognito,/api/auth/also/cognito")));
    }

    @Test
    void shouldSendTheMainProviderToTheDefaultPath() {
        assertEquals("/api/auth/login", loginUrlOf("google",
            Map.of("quarkus.oidc.cognito.tenant-paths", "/api/auth/login/cognito")));
    }

    private static String loginUrlOf(String id, Map<String, String> properties) {
        Config config = new SmallRyeConfigBuilder()
            .withSources(new PropertiesConfigSource(properties, "test", 100))
            .build();
        AuthProvidersConfig providers = new StubConfig(Map.of(id, new StubProvider()));
        AuthProviderResponse only = new AuthProviderResource(providers, config).providers().providers().getFirst();
        return only.loginUrl();
    }

    /** Authentication on, with the given providers. */
    private record StubConfig(Map<String, ProviderConfig> providers) implements AuthProvidersConfig {
        @Override
        public boolean enabled() {
            return true;
        }
    }

    /** A fully configured provider. */
    private record StubProvider() implements ProviderConfig {
        @Override
        public String label() {
            return "A provider";
        }

        @Override
        public Optional<String> clientId() {
            return Optional.of("client");
        }

        @Override
        public Optional<String> clientSecret() {
            return Optional.of("secret");
        }

        @Override
        public Optional<String> issuer() {
            return Optional.of("https://issuer");
        }
    }
}
