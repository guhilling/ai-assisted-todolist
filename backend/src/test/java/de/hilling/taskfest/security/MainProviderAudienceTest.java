package de.hilling.taskfest.security;

import io.smallrye.config.PropertiesConfigSource;
import io.smallrye.config.SmallRyeConfig;
import io.smallrye.config.SmallRyeConfigBuilder;
import java.io.IOException;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasItems;

/**
 * Keeps the audiences the providers accept in step with the clients that sign in with them (#266).
 *
 * <p>In {@code prod} the main tenant lists its audiences, so that Google's iOS client can be among
 * them. The list must name the client id the tenant actually runs with: the end-to-end stack sets
 * that in a properties file, not through the Google variable, and an audience list built from the
 * variable would then have refused every sign-in there. The test accounts' tenant lists the app's
 * own public client beside the backend's, since an installed app cannot keep a secret, and so do
 * the local Keycloak in dev mode and in the end-to-end stack, for the app's dev build (#267). A plain
 * test, resolving {@code application.properties} as Quarkus would: the prod profile cannot be
 * booted in a test.</p>
 */
class MainProviderAudienceTest {

    private static final Path PROPERTIES = Path.of("src/main/resources/application.properties");

    private static final Path END_TO_END = Path.of("../e2e/backend-e2e.properties");

    @ParameterizedTest
    @ValueSource(strings = {"prod", "qa"})
    void shouldAcceptTheClientIdTheTenantRunsWith(String profile) throws IOException {
        SmallRyeConfig config = new SmallRyeConfigBuilder()
            .withProfile(profile)
            .withSources(new PropertiesConfigSource(PROPERTIES.toUri().toURL(), 100))
            // What the end-to-end stack's backend-e2e.properties does: a higher ordinal wins.
            .withSources(new PropertiesConfigSource(
                Map.of("%" + profile + ".quarkus.oidc.client-id", "taskfest-backend"), "override", 200))
            .build();

        List<String> audience = config.getValues("quarkus.oidc.token.audience", String.class);

        assertThat(audience, hasItem("taskfest-backend"));
    }

    @Test
    void shouldLetTheAppsDevBuildSignInWithTheLocalKeycloak() throws IOException {
        SmallRyeConfig config = new SmallRyeConfigBuilder()
            .withProfile("dev")
            .withSources(new PropertiesConfigSource(PROPERTIES.toUri().toURL(), 100))
            .build();

        List<String> audience = config.getValues("quarkus.oidc.token.audience", String.class);

        assertThat(audience, hasItems("taskfest-backend", "taskfest-app"));
    }

    @Test
    void shouldLetTheAppSignInToTheEndToEndStack() throws IOException {
        SmallRyeConfig config = new SmallRyeConfigBuilder()
            .withProfile("prod")
            .withSources(new PropertiesConfigSource(PROPERTIES.toUri().toURL(), 100))
            // Where the end-to-end stack mounts it: SMALLRYE_CONFIG_LOCATIONS, above the defaults.
            .withSources(new PropertiesConfigSource(END_TO_END.toUri().toURL(), 260))
            .build();

        List<String> audience = config.getValues("quarkus.oidc.token.audience", String.class);

        assertThat(audience, hasItems("taskfest-backend", "taskfest-app"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"taskfest-cognito-backend", "taskfest-cognito-app"})
    void shouldLetTheTestAccountsSignInThroughTheBackendAndTheApp(String client) throws IOException {
        SmallRyeConfig config = new SmallRyeConfigBuilder()
            .withProfile("prod")
            .withSources(new PropertiesConfigSource(PROPERTIES.toUri().toURL(), 100))
            .withSources(new PropertiesConfigSource(Map.of(
                "TASKFEST_OIDC_COGNITO_CLIENT_ID", "taskfest-cognito-backend",
                "TASKFEST_OIDC_COGNITO_APP_CLIENT_ID", "taskfest-cognito-app"), "environment", 300))
            .build();

        List<String> audience = config.getValues("quarkus.oidc.cognito.token.audience", String.class);

        assertThat(audience, hasItem(client));
    }
}
