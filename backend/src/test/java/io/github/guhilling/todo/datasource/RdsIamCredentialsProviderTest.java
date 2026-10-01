package io.github.guhilling.todo.datasource;

import io.quarkus.credentials.CredentialsProvider;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.AwsCredentials;
import software.amazon.awssdk.auth.credentials.AwsCredentialsProvider;
import software.amazon.awssdk.regions.Region;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.startsWith;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * Pins down the IAM authentication token handed to the database, without Quarkus or AWS.
 *
 * <p>The token is a presigned request, signed locally from whatever credentials the task role
 * provides, so its shape can be checked offline. What cannot be checked here is that RDS
 * accepts it; that only happens against a real instance.</p>
 */
class RdsIamCredentialsProviderTest {

    private static final String HOST = "todolist-qa-db.abc123.eu-central-1.rds.amazonaws.com";
    private static final String URL = "jdbc:postgresql://" + HOST + ":5432/todolist?sslmode=verify-full";
    private static final String USER = "todolist_qa";
    private static final AwsCredentials KEYS = AwsBasicCredentials.create("AKIDEXAMPLE", "not-a-secret");

    @Test
    void shouldHandTheConfiguredUserToTheDatabase() {
        Map<String, String> credentials = provider(() -> KEYS).getCredentials("rds-iam");

        assertThat(credentials.get(CredentialsProvider.USER_PROPERTY_NAME), equalTo(USER));
    }

    @Test
    void shouldUseAConnectTokenForThisHostAndUserAsThePassword() {
        String token = provider(() -> KEYS).getCredentials("rds-iam").get(CredentialsProvider.PASSWORD_PROPERTY_NAME);

        assertThat(token, startsWith(HOST + ":5432/?"));
        assertThat(token, containsString("Action=connect"));
        assertThat(token, containsString("DBUser=" + USER));
    }

    /** Signed for RDS in the instance's region, with the caller's key, for RDS's maximum of 15 minutes. */
    @Test
    void shouldSignTheTokenForRdsInTheConfiguredRegion() {
        String token = provider(() -> KEYS).getCredentials("rds-iam").get(CredentialsProvider.PASSWORD_PROPERTY_NAME);

        assertThat(token, containsString("X-Amz-Credential=AKIDEXAMPLE%2F"));
        assertThat(token, containsString("%2Feu-central-1%2Frds-db%2Faws4_request"));
        assertThat(token, containsString("X-Amz-Expires=900"));
    }

    /**
     * A token outlives nothing: it is valid for 15 minutes and a pool opens connections for as
     * long as the service runs, so every call must sign afresh from the current task-role
     * credentials, which rotate too.
     */
    @Test
    void shouldSignAfreshOnEveryCall() {
        AtomicInteger resolved = new AtomicInteger();
        RdsIamCredentialsProvider provider = provider(() -> {
            resolved.incrementAndGet();
            return KEYS;
        });

        provider.getCredentials("rds-iam");
        provider.getCredentials("rds-iam");

        assertThat(resolved.get(), equalTo(2));
    }

    @Test
    void shouldTakeTheEndpointFromTheJdbcUrl() {
        assertThat(RdsEndpoint.fromJdbcUrl(URL), equalTo(new RdsEndpoint(HOST, 5432)));
    }

    @Test
    void shouldDefaultToThePostgresPortWhenTheUrlNamesNone() {
        assertThat(RdsEndpoint.fromJdbcUrl("jdbc:postgresql://" + HOST + "/todolist"),
            equalTo(new RdsEndpoint(HOST, RdsEndpoint.POSTGRES_PORT)));
    }

    @Test
    void shouldRefuseAUrlThatIsNotPostgres() {
        assertThrows(IllegalArgumentException.class,
            () -> RdsEndpoint.fromJdbcUrl("jdbc:mysql://" + HOST + ":3306/todolist"));
    }

    private static RdsIamCredentialsProvider provider(AwsCredentialsProvider keys) {
        return new RdsIamCredentialsProvider(URL, USER, Region.EU_CENTRAL_1, keys);
    }
}
