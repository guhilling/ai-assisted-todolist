package de.hilling.taskfest.api;

import io.smallrye.config.ConfigMapping;
import jakarta.validation.constraints.Size;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.media.Content;
import org.eclipse.microprofile.openapi.annotations.media.ExampleObject;
import org.eclipse.microprofile.openapi.annotations.media.Schema;
import org.eclipse.microprofile.openapi.annotations.responses.APIResponse;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/**
 * Serves the sign-in options the landing page offers before anyone is authenticated.
 *
 * <p>A provider is advertised as usable purely because configuration gave it credentials,
 * never because its name is known to this class. That is what lets the same code offer
 * Google in production and the local Keycloak in dev and test: the profile decides which
 * {@code todo.auth.providers.*} entries exist.</p>
 *
 * <p>An entry without a client id or secret is still reported, with {@code available} false
 * and a null {@code loginUrl}. Reporting it rather than omitting it is what lets the caller
 * tell "this deployment has no sign-in configured" apart from "the list could not be
 * fetched" — the frontend hides such an entry, so a fresh production deployment shows no
 * Google button at all until its secrets are supplied.</p>
 */
@Path("/api/auth/providers")
@Produces(MediaType.APPLICATION_JSON)
@Tag(name = "Authentication", description = "The browser side of sign-in, sign-out, and the current session.")
public class AuthProviderResource {

    /** A provider's configuration key, such as {@code google}. Ours to choose, and short. */
    private static final int MAX_PROVIDER_ID_LENGTH = 64;

    /** The name that goes on the sign-in button. */
    private static final int MAX_PROVIDER_LABEL_LENGTH = 100;

    /** The practical ceiling for a URL; see {@code doc/decisions/domain-and-backend.md} for the published bounds. */
    private static final int MAX_URL_LENGTH = 2048;

    private static final String LOGIN_PATH = "/api/auth/login";

    private final AuthProvidersConfig authProvidersConfig;

    public AuthProviderResource(AuthProvidersConfig authProvidersConfig) {
        this.authProvidersConfig = authProvidersConfig;
    }

    @GET
    @Operation(summary = "List the configured sign-in providers", description = "Every provider this "
        + "deployment declares, usable or not, needing no authentication to ask.")
    @APIResponse(responseCode = "200", description = "The configured providers.",
        content = @Content(mediaType = MediaType.APPLICATION_JSON,
            schema = @Schema(implementation = AuthProvidersResponse.class),
            examples = @ExampleObject(name = "providers", value = """
            {
              "enabled": true,
              "providers": [
                {
                  "id": "google",
                  "label": "Google",
                  "available": true,
                  "loginUrl": "/api/auth/login",
                  "issuer": "https://accounts.google.com"
                }
              ]
            }""")))
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
     * none — that is how production ships a declared Google provider that is not yet offered,
     * until the deployment supplies {@code TODO_OIDC_GOOGLE_CLIENT_ID} and its secret.</p>
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
     * <p>Both fields are marked required in the generated schema, which the frontend compiles
     * into a runtime validator. Neither is ever absent, so this only writes down what the
     * record already guarantees.</p>
     *
     * @param providers every configured provider, usable or not, ordered by id
     */
    @Schema(requiredProperties = {"enabled", "providers"})
    public record AuthProvidersResponse(boolean enabled, List<AuthProviderResponse> providers) {
    }

    /**
     * A single sign-in option: what to label it, whether it is usable, and where to send the
     * browser when it is.
     *
     * <p>{@code loginUrl} is null for an unusable provider rather than the provider being
     * left out of the list, so a caller can distinguish a provider that exists but is not
     * configured from one that was never declared. What the frontend does with that is its
     * own decision, and it currently offers only the usable ones.</p>
     *
     * @param id the configuration key of the provider, for example {@code google}
     * @param label the human-readable name to put on the button
     * @param available whether credentials are configured, and so whether it can be used
     * @param loginUrl where to send the browser to start sign-in, or null when unavailable
     * <p>Every field is required in the generated schema, {@code loginUrl} among them even
     * though it is nullable: the frontend compiles that schema into a runtime validator, and
     * the distinction above only works if an unusable provider still carries the field, set to
     * null. Required and nullable are different claims, and both are meant here.</p>
     *
     * <p>That is also why this record lists its required properties on the type instead of
     * using {@code @NotNull} on each component, as the other responses do: {@code @NotNull}
     * would make the field required *and* assert it is never null, and here the second half is
     * untrue. {@code available} is a primitive, which needs listing for the same reason.</p>
     *
     * @param issuer the provider's issuer URL, empty when it was never configured
     */
    @Schema(requiredProperties = {"id", "label", "available", "loginUrl", "issuer"})
    public record AuthProviderResponse(
        @Size(max = MAX_PROVIDER_ID_LENGTH) @Schema(example = "google") String id,
        @Size(max = MAX_PROVIDER_LABEL_LENGTH) @Schema(example = "Google") String label,
        boolean available,
        @Size(max = MAX_URL_LENGTH) @Schema(example = "/api/auth/login", nullable = true) String loginUrl,
        @Size(max = MAX_URL_LENGTH) @Schema(example = "https://accounts.google.com") String issuer
    ) {
    }
}
