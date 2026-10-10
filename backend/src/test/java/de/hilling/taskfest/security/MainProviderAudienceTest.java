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
 * Keeps the main provider's accepted audiences following its client id, however that is set
 * (#266).
 *
 * <p>In {@code prod} the main tenant lists its audiences, so that Google's iOS client can be among
 * them. The list must name the client id the tenant actually runs with: the end-to-end stack sets
 * that in a properties file, not through the Google variable, and an audience list built from the
 * variable would then have refused every sign-in there. A plain test, resolving
 * {@code application.properties} as Quarkus would: the prod profile cannot be booted in a test.</p>
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
}
