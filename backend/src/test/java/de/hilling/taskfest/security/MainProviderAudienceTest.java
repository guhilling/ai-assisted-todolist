package de.hilling.taskfest.security;

import io.smallrye.config.PropertiesConfigSource;
import io.smallrye.config.SmallRyeConfig;
import io.smallrye.config.SmallRyeConfigBuilder;
import java.io.IOException;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.hasItem;

/**
 * Keeps the audiences the providers accept in step with the clients that sign in with them (#266).
 *
 * <p>In {@code prod} the main tenant lists its audiences, so that Google's iOS client can be among
 * them. The list must name the client id the tenant actually runs with: the end-to-end stack sets
 * that in a properties file, not through the Google variable, and an audience list built from the
 * variable would then have refused every sign-in there. The test accounts' tenant lists the app's
 * own public client beside the backend's, since an installed app cannot keep a secret. A plain
 * test, resolving {@code application.properties} as Quarkus would: the prod profile cannot be
 * booted in a test.</p>
 */
class MainProviderAudienceTest {

    private static final Path PROPERTIES = Path.of("src/main/resources/application.properties");

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
