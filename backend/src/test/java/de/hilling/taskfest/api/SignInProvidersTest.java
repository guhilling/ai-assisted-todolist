package de.hilling.taskfest.api;

import de.hilling.taskfest.api.AuthProviderResource.AuthProvidersConfig;
import de.hilling.taskfest.api.AuthProviderResource.ProviderConfig;
import io.smallrye.config.PropertiesConfigSource;
import io.smallrye.config.SmallRyeConfigBuilder;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.eclipse.microprofile.config.Config;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Which provider is the main one, which are named tenants, and where each signs in (#143).
 *
 * <p>A plain unit test: {@link SignInProviders} is a decision about configuration, fed here
 * directly as the providers and each id's {@code tenant-paths}.</p>
 */
class SignInProvidersTest {

    private static final Map<String, List<String>> COGNITO_TENANT =
        Map.of("cognito", List.of("/api/auth/login/cognito", "/api/auth/callback/cognito"));

    @Test
    void shouldSendANamedTenantsProviderToItsLoginPathNotItsCallback() {
        SignInProviders providers = SignInProviders.of(available("google", "cognito"), COGNITO_TENANT);

        assertEquals(Optional.of("/api/auth/login/cognito"), providers.loginPath("cognito"));
        assertTrue(providers.isNamedTenant("cognito"));
    }

    @Test
    void shouldTreatTheProviderWithoutATenantAsTheMainOne() {
        SignInProviders providers = SignInProviders.of(available("google", "cognito"), COGNITO_TENANT);

        assertEquals(Optional.empty(), providers.loginPath("google"));
        assertFalse(providers.isNamedTenant("google"));
        assertEquals(List.of(), providers.problems());
    }

    @Test
    void shouldNameEachTenantByItsProviderId() {
        SignInProviders providers = SignInProviders.of(available("google", "cognito"), COGNITO_TENANT);

        assertEquals("google", providers.providerOfTenant(SignInProviders.DEFAULT_TENANT));
        assertEquals("cognito", providers.providerOfTenant("cognito"));
    }

    @Test
    void shouldReportTwoProvidersThatBothClaimToBeTheMainOne() {
        // Forgetting a provider's tenant-paths, or misspelling its tenant, used to show a button
        // that silently signed in with the main provider instead.
        SignInProviders providers = SignInProviders.of(available("google", "cognito"), Map.of());

        assertEquals(1, providers.problems().size());
        assertTrue(providers.problems().getFirst().contains("cognito"));
    }

    @Test
    void shouldIgnoreAProviderThatIsNotAvailable() {
        Map<String, ProviderConfig> declared = new LinkedHashMap<>();
        declared.put("google", provider(Optional.empty()));
        declared.put("keycloak", provider(Optional.of("secret")));

        SignInProviders providers = SignInProviders.of(new StubConfig(true, declared), Map.of());

        assertEquals(List.of(), providers.problems());
        assertEquals("keycloak", providers.providerOfTenant(SignInProviders.DEFAULT_TENANT));
    }

    @Test
    void shouldFindNoProblemWhileSignInIsOff() {
        assertEquals(List.of(), SignInProviders.of(new StubConfig(false,
            Map.of("google", provider(Optional.of("s")), "cognito", provider(Optional.of("s")))), Map.of()).problems());
    }

    @Test
    void shouldPickTheLoginPathWhicheverOrderTheTenantPathsAreIn() {
        SignInProviders providers = SignInProviders.of(available("google", "cognito"),
            Map.of("cognito", List.of("/api/auth/callback/cognito", "/api/auth/login/cognito")));

        assertEquals(Optional.of("/api/auth/login/cognito"), providers.loginPath("cognito"));
    }

    @Test
    void shouldReadEachProvidersTenantPathsFromConfiguration() {
        Config config = new SmallRyeConfigBuilder()
            .withSources(new PropertiesConfigSource(
                Map.of("quarkus.oidc.cognito.tenant-paths", "/api/auth/login/cognito,/api/auth/callback/cognito"),
                "test", 100))
            .build();

        SignInProviders providers = new SignInProviders(available("google", "cognito"), config);

        assertEquals(Optional.of("/api/auth/login/cognito"), providers.loginPath("cognito"));
        assertEquals(List.of(), providers.problems());
    }

    @Test
    void shouldRefuseToStartWithTwoMainProviders() {
        SignInProviders providers = SignInProviders.of(available("google", "cognito"), Map.of());

        assertThrows(IllegalStateException.class, () -> providers.checkAtStartup(null));
    }

    @Test
    void shouldStartWithOneMainProvider() {
        assertDoesNotThrow(() -> SignInProviders.of(available("google", "cognito"), COGNITO_TENANT).checkAtStartup(null));
    }

    @Test
    void shouldNameTheAttributeQuarkusRecordsTheTenantUnder() {
        assertFalse(SignInProviders.tenantAttribute().isBlank());
    }

    private static AuthProvidersConfig available(String... ids) {
        Map<String, ProviderConfig> providers = new LinkedHashMap<>();
        for (String id : ids) {
            providers.put(id, provider(Optional.of("secret")));
        }
        return new StubConfig(true, providers);
    }

    private static ProviderConfig provider(Optional<String> secret) {
        return new StubProvider("A provider", Optional.of("client"), secret, Optional.of("https://issuer"));
    }

    /** Stands in for the {@code taskfest.auth} config tree. */
    private record StubConfig(boolean enabled, Map<String, ProviderConfig> providers) implements AuthProvidersConfig {
    }

    /** Stands in for one {@code taskfest.auth.providers.*} entry. */
    private record StubProvider(
        String label,
        Optional<String> clientId,
        Optional<String> clientSecret,
        Optional<String> issuer
    ) implements ProviderConfig {
    }
}
