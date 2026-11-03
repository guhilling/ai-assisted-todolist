package de.hilling.taskfest.security;

import io.smallrye.config.PropertiesConfigSource;
import io.smallrye.config.SmallRyeConfig;
import io.smallrye.config.SmallRyeConfigBuilder;
import java.io.IOException;
import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Pins down that the main OIDC tenant is on exactly when sign-in is (#511).
 *
 * <p>{@code quarkus.oidc.enabled} is fixed when the image is built, so the deployed image always
 * has OIDC; the tenant is what can be switched at run time. Left on with sign-in off, it still
 * needs a client id, and the container stack -- which passes the Google client's id empty when
 * there is none -- refused to start. The test profile has tied the tenant to the switch since
 * #134; this is the same for the profiles the image runs in. A plain test, resolving
 * {@code application.properties} as Quarkus would: the prod profile cannot be booted in a test.</p>
 */
class MainTenantFollowsSignInTest {

    private static final Path PROPERTIES = Path.of("src/main/resources/application.properties");

    @ParameterizedTest
    @ValueSource(strings = {"prod", "qa"})
    void shouldSwitchTheTenantOffWithSignIn(String profile) throws IOException {
        // What the container stack passes without a .env: sign-in off, the Google client empty.
        SmallRyeConfig config = configFor(profile, Map.of(
            "TASKFEST_AUTH_ENABLED", "false",
            "TASKFEST_OIDC_GOOGLE_CLIENT_ID", ""));

        assertFalse(tenantEnabled(config));
    }

    @ParameterizedTest
    @ValueSource(strings = {"prod", "qa"})
    void shouldKeepTheTenantOnWithSignIn(String profile) throws IOException {
        SmallRyeConfig config = configFor(profile, Map.of(
            "TASKFEST_AUTH_ENABLED", "true",
            "TASKFEST_OIDC_GOOGLE_CLIENT_ID", "client"));

        assertTrue(tenantEnabled(config));
    }

    private static SmallRyeConfig configFor(String profile, Map<String, String> environment) throws IOException {
        return new SmallRyeConfigBuilder()
            .withProfile(profile)
            .withSources(new PropertiesConfigSource(PROPERTIES.toUri().toURL(), 100))
            // Where environment variables sit for Quarkus: above application.properties.
            .withSources(new PropertiesConfigSource(environment, "environment", 300))
            .build();
    }

    /** As Quarkus reads it: a tenant is on unless it is switched off. */
    private static boolean tenantEnabled(SmallRyeConfig config) {
        return config.getOptionalValue("quarkus.oidc.tenant-enabled", Boolean.class).orElse(true);
    }
}
