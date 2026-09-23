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

    private final AuthProvidersConfig authProvidersConfig;

    public AuthProviderResource(AuthProvidersConfig authProvidersConfig) {
        this.authProvidersConfig = authProvidersConfig;
    }

    @GET
    public AuthProvidersResponse providers() {
        List<AuthProviderResponse> providers = authProvidersConfig.providers().entrySet().stream()
            .map(entry -> new AuthProviderResponse(
                entry.getKey(),
                entry.getValue().label(),
                authProvidersConfig.enabled() && entry.getValue().clientId().filter(clientId -> !clientId.isBlank()).isPresent(),
                entry.getValue().issuer().orElse(""),
                entry.getValue().redirectUri().orElse("")))
            .toList();
        return new AuthProvidersResponse(authProvidersConfig.enabled(), providers);
    }

    @ConfigMapping(prefix = "todo.auth")
    public interface AuthProvidersConfig {
        boolean enabled();
        Map<String, ProviderConfig> providers();
    }

    public interface ProviderConfig {
        String label();
        Optional<String> clientId();
        Optional<String> issuer();
        Optional<String> redirectUri();
    }

    public record AuthProvidersResponse(boolean enabled, List<AuthProviderResponse> providers) {
    }

    public record AuthProviderResponse(
        String id,
        String label,
        boolean configured,
        String issuer,
        String redirectUri
    ) {
    }
}
