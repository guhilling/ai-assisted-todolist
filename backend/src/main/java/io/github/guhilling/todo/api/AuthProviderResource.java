package io.github.guhilling.todo.api;

import io.smallrye.config.ConfigMapping;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Path("/api/auth/providers")
@Produces(MediaType.APPLICATION_JSON)
public class AuthProviderResource {

    private static final String LOGIN_PATH = "/api/auth/login";

    private final AuthProvidersConfig authProvidersConfig;

    public AuthProviderResource(AuthProvidersConfig authProvidersConfig) {
        this.authProvidersConfig = authProvidersConfig;
    }

    @GET
    public AuthProvidersResponse providers() {
        List<AuthProviderResponse> providers = authProvidersConfig.providers().entrySet().stream()
            .sorted(Map.Entry.comparingByKey())
            .map(entry -> {
                boolean available = authProvidersConfig.enabled()
                    && isPresent(entry.getValue().clientId())
                    && isPresent(entry.getValue().clientSecret());
                return new AuthProviderResponse(
                    entry.getKey(),
                    entry.getValue().label(),
                    available,
                    available ? LOGIN_PATH : null,
                    entry.getValue().issuer().orElse(""));
            })
            .toList();
        return new AuthProvidersResponse(authProvidersConfig.enabled(), providers);
    }

    private static boolean isPresent(Optional<String> value) {
        return value.filter(candidate -> !candidate.isBlank()).isPresent();
    }

    @ConfigMapping(prefix = "todo.auth")
    public interface AuthProvidersConfig {
        boolean enabled();
        Map<String, ProviderConfig> providers();
    }

    public interface ProviderConfig {
        String label();
        Optional<String> clientId();
        Optional<String> clientSecret();
        Optional<String> issuer();
    }

    public record AuthProvidersResponse(boolean enabled, List<AuthProviderResponse> providers) {
    }

    public record AuthProviderResponse(
        String id,
        String label,
        boolean available,
        String loginUrl,
        String issuer
    ) {
    }
}
