package de.hilling.taskfest.datasource;

import io.quarkus.credentials.CredentialsProvider;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.inject.Named;
import java.util.Map;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import software.amazon.awssdk.auth.credentials.AwsCredentialsProvider;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.regions.providers.DefaultAwsRegionProviderChain;
import software.amazon.awssdk.services.rds.RdsUtilities;

/**
 * Logs the application into RDS with its IAM identity instead of a password.
 *
 * <p>On ECS that identity is the task role, whose credentials the container receives from the
 * ECS credentials endpoint — the counterpart of an EKS service account. Each call signs a
 * fresh authentication token from them, valid for 15 minutes. Agroal asks for credentials every
 * time it opens a connection, so a pooled connection is always opened with a current token, and
 * nothing secret is ever configured, injected or rotated.</p>
 *
 * <p>Switched on only by configuration ({@code quarkus.datasource.credentials-provider}), and
 * only in AWS. Development, tests and the Compose stacks keep their ordinary password.</p>
 */
@ApplicationScoped
@Named(RdsIamCredentialsProvider.BEAN_NAME)
public class RdsIamCredentialsProvider implements CredentialsProvider {

    /** What {@code quarkus.datasource.credentials-provider-name} must name to select this bean. */
    public static final String BEAN_NAME = "rds-iam";

    private final String username;
    private final RdsEndpoint endpoint;
    private final RdsUtilities rds;

    /**
     * The production wiring: the datasource's own URL and user, and the SDK's default region
     * and credentials chains, which on ECS resolve to {@code AWS_REGION} and the task role.
     */
    @Inject
    RdsIamCredentialsProvider(
        @ConfigProperty(name = "quarkus.datasource.jdbc.url") String jdbcUrl,
        @ConfigProperty(name = "quarkus.datasource.username") String username) {
        this(jdbcUrl, username, new DefaultAwsRegionProviderChain().getRegion(),
            DefaultCredentialsProvider.builder().build());
    }

    RdsIamCredentialsProvider(String jdbcUrl, String username, Region region, AwsCredentialsProvider keys) {
        this.username = username;
        this.endpoint = RdsEndpoint.fromJdbcUrl(jdbcUrl);
        this.rds = RdsUtilities.builder().region(region).credentialsProvider(keys).build();
    }

    @Override
    public Map<String, String> getCredentials(String credentialsProviderName) {
        String token = rds.generateAuthenticationToken(request -> request
            .hostname(endpoint.host())
            .port(endpoint.port())
            .username(username));
        return Map.of(USER_PROPERTY_NAME, username, PASSWORD_PROPERTY_NAME, token);
    }
}
