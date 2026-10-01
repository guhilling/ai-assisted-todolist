package io.github.guhilling.todo.datasource;

import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.Map;
import org.junit.jupiter.api.Test;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.equalTo;

/**
 * Proves the property IAM database authentication depends on, against the real Agroal pool and
 * Dev Services' PostgreSQL: a configured credentials provider is asked again for <em>every</em>
 * connection the pool opens, not once at start-up.
 *
 * <p>An IAM token is valid for 15 minutes and the pool opens connections for as long as the
 * service runs, so credentials fetched once would work in every test and fail in production a
 * quarter of an hour after the first idle connection was replaced. That is the regression this
 * pins down, and it is a property of the framework, which is why it needs a booted Quarkus.</p>
 */
@QuarkusTest
@TestProfile(DatasourceCredentialsPerConnectionTest.CountingProfile.class)
class DatasourceCredentialsPerConnectionTest {

    @Inject
    AgroalDataSource dataSource;

    @Inject
    CountingCredentialsProvider credentials;

    @Test
    void shouldAskForCredentialsForEveryNewConnection() throws SQLException {
        int before = credentials.calls();

        try (Connection first = dataSource.getConnection(); Connection second = dataSource.getConnection()) {
            assertThat(first.isValid(1) && second.isValid(1), equalTo(true));
        }

        assertThat(credentials.calls() - before, equalTo(2));
    }

    /**
     * Selects the counting provider exactly the way production selects the IAM one.
     *
     * <p>Pooling is off so that every {@code getConnection()} is a new physical connection, which
     * makes the count exact. Agroal's pool opens its connections through the same factory, and
     * the factory is where the credentials are read; flushing a pool instead races its
     * asynchronous housekeeping and can hand back a connection that is being closed.</p>
     */
    public static class CountingProfile implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            return Map.of(
                "quarkus.datasource.credentials-provider", CountingCredentialsProvider.BEAN_NAME,
                "quarkus.datasource.credentials-provider-name", CountingCredentialsProvider.BEAN_NAME,
                "quarkus.datasource.jdbc.pooling-enabled", "false");
        }
    }
}
