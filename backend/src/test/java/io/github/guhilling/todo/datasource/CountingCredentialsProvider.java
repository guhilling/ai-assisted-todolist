package io.github.guhilling.todo.datasource;

import io.quarkus.credentials.CredentialsProvider;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Named;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/**
 * Stands in for {@link RdsIamCredentialsProvider} against Dev Services, counting how often the
 * datasource asks: Dev Services' PostgreSQL knows nothing of IAM, so it hands back the password
 * Dev Services generated, and only the number of calls is of interest.
 */
@ApplicationScoped
@Named(CountingCredentialsProvider.BEAN_NAME)
public class CountingCredentialsProvider implements CredentialsProvider {

    /** The name the test profile selects this bean by. */
    public static final String BEAN_NAME = "counting";

    private final AtomicInteger calls = new AtomicInteger();

    @ConfigProperty(name = "quarkus.datasource.username")
    String username;

    @ConfigProperty(name = "quarkus.datasource.password")
    String password;

    @Override
    public Map<String, String> getCredentials(String credentialsProviderName) {
        calls.incrementAndGet();
        return Map.of(USER_PROPERTY_NAME, username, PASSWORD_PROPERTY_NAME, password);
    }

    /** How many times credentials have been asked for so far. */
    public int calls() {
        return calls.get();
    }
}
