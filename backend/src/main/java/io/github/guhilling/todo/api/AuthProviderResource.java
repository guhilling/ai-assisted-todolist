package io.github.guhilling.todo.api;

import io.smallrye.config.ConfigMapping;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Serves the sign-in cards the landing page offers before anyone is authenticated.
 *
 * <p>A provider is advertised as usable purely because configuration gave it credentials,
 * never because its name is known to this class. That is what lets the same code offer
 * Google in production and the local Keycloak in dev and test: the profile decides which
 * {@code todo.auth.providers.*} entries exist, and an entry without a client id or secret
 * renders as a disabled card rather than a broken link.</p>
 */
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

    /**
     * Binds the {@code todo.auth} configuration tree, which is the only thing that decides
     * which providers exist and whether sign-in is offered at all.
     *
     * <p>Keying the providers by map entry rather than by fixed properties means a new
     * provider is a configuration change, not a code change, and a profile can add or
     * remove one without this class knowing its name.</p>
     */
    @ConfigMapping(prefix = "todo.auth")
    public interface AuthProvidersConfig {
        boolean enabled();
        Map<String, ProviderConfig> providers();
    }

    /**
     * One configured identity provider.
     *
     * <p>The credentials are optional because a provider may legitimately be declared with
     * none — that is how production ships a Google card that stays disabled until the
     * deployment supplies {@code TODO_OIDC_GOOGLE_CLIENT_ID} and its secret.</p>
     */
    public interface ProviderConfig {
        String label();
        Optional<String> clientId();
        Optional<String> clientSecret();
        Optional<String> issuer();
    }

    /**
     * The payload behind {@code GET /api/auth/providers}, consumed by the frontend's
     * {@code AuthProvidersResponse} type.
     *
     * <p>{@code enabled} is reported separately from the per-provider flags so the UI can
     * tell "authentication is switched off here" apart from "this provider is not set up".</p>
     *
     * @param enabled whether authentication is switched on for this deployment at all
     * @param providers every configured provider, usable or not, ordered by id
     */
    public record AuthProvidersResponse(boolean enabled, List<AuthProviderResponse> providers) {
    }

    /**
     * A single sign-in card: what to label it, whether to make it clickable, and where to
     * send the browser when it is.
     *
     * <p>{@code loginUrl} is null for an unusable provider rather than absent, so the
     * frontend can render the card greyed out instead of hiding it.</p>
     *
     * @param id the configuration key of the provider, for example {@code google}
     * @param label the human-readable name to put on the card
     * @param available whether credentials are configured, and so whether the card is clickable
     * @param loginUrl where to send the browser to start sign-in, or null when unavailable
     * @param issuer the provider's issuer URL, empty when it was never configured
     */
    public record AuthProviderResponse(
        String id,
        String label,
        boolean available,
        String loginUrl,
        String issuer
    ) {
    }
}
