package de.hilling.taskfest.security;

import io.quarkus.oidc.AccessTokenCredential;
import io.quarkus.oidc.IdTokenCredential;
import io.quarkus.oidc.runtime.OidcUtils;
import io.quarkus.security.AuthenticationFailedException;
import io.quarkus.security.identity.AuthenticationRequestContext;
import io.quarkus.security.identity.SecurityIdentity;
import io.quarkus.security.identity.SecurityIdentityAugmentor;
import io.quarkus.security.runtime.QuarkusSecurityIdentity;
import io.smallrye.mutiny.Uni;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;
import java.util.function.Predicate;
import java.util.function.UnaryOperator;
import org.eclipse.microprofile.config.Config;
import org.eclipse.microprofile.jwt.JsonWebToken;

/**
 * Lets an installed app sign in with the ID token its platform's sign-in gave it, sent as
 * {@code Authorization: Bearer} (#266).
 *
 * <p>The website never holds a token: the backend runs the code flow and keeps the tokens in its
 * session cookie. An app cannot work that way -- Google refuses sign-in inside a WebView, and a
 * cookie set in the system browser never reaches the app -- so every tenant is {@code hybrid}, and
 * Quarkus verifies a bearer token's signature, issuer and expiry as it would an access token. Two
 * things it would not do are done here.</p>
 *
 * <ul>
 *   <li><b>The token must have been issued to us.</b> Quarkus checks a bearer token's audience only
 *   where {@code token.audience} is configured. Without it, an ID token any other application
 *   obtained from the same provider -- every site with a Google sign-in -- would sign its holder in
 *   here as that user. So a tenant that does not name its audience accepts only tokens whose
 *   audience includes its client id. Nothing per tenant to forget: a new provider is safe without
 *   a line of extra configuration.</li>
 *   <li><b>Only an ID token is a way in.</b> A bearer identity without a signed token behind it --
 *   an opaque token Quarkus verified by introspection -- is refused, since neither this rule nor
 *   {@link VerifiedEmail}'s has claims to check; so is a token declaring itself an access token
 *   (Keycloak's {@code typ}, Cognito's {@code token_use}). And {@code token.audience=any}, with
 *   which Quarkus checks no audience, does not count as a tenant naming its own.</li>
 *   <li><b>The bearer token is the ID token.</b> The resources read their claims through
 *   {@code @IdToken}, which Quarkus fills only in the code flow. Giving a bearer identity the same
 *   token as its ID token credential lets every resource work unchanged for both, and keeps
 *   {@code ClaimsComeFromTheIdTokenTest}'s rule meaningful: an opaque Google access token still
 *   never becomes a source of claims.</li>
 * </ul>
 *
 * <p>Whether the email is verified is {@link VerifiedEmail}'s rule, and applies to both.</p>
 */
@ApplicationScoped
public class BearerIdToken implements SecurityIdentityAugmentor {

    private static final String OIDC = "quarkus.oidc.";

    /** Keycloak's claim naming a token's kind: {@code ID} for an ID token, {@code Bearer} otherwise. */
    private static final String TYPE = "typ";

    /** Cognito's claim naming a token's kind: {@code id} or {@code access}. */
    private static final String TOKEN_USE = "token_use";

    private static final String ID_TYPE = "id";

    /** Quarkus' value for "any audience", with which it checks none. */
    private static final String ANY_AUDIENCE = "any";

    private final UnaryOperator<String> clientIdOfTenant;

    private final Predicate<String> tenantNamesItsAudience;

    @Inject
    BearerIdToken(Config config) {
        this(cachedPerTenant(tenant -> clientId(config, tenant))::apply,
            cachedPerTenant(tenant -> namesItsAudience(config, tenant))::apply);
    }

    /** A tenant's settings are fixed once it runs, so each is read from configuration once. */
    private static <T> Function<String, T> cachedPerTenant(Function<String, T> lookup) {
        Map<String, Optional<T>> cache = new ConcurrentHashMap<>();
        return tenant -> cache.computeIfAbsent(String.valueOf(tenant), key -> Optional.ofNullable(lookup.apply(tenant)))
            .orElse(null);
    }

    /**
     * @param clientIdOfTenant each tenant's client id, by the tenant id Quarkus records
     * @param tenantNamesItsAudience whether a tenant configures {@code token.audience} itself
     */
    BearerIdToken(UnaryOperator<String> clientIdOfTenant, Predicate<String> tenantNamesItsAudience) {
        this.clientIdOfTenant = clientIdOfTenant;
        this.tenantNamesItsAudience = tenantNamesItsAudience;
    }

    @Override
    public Uni<SecurityIdentity> augment(SecurityIdentity identity, AuthenticationRequestContext context) {
        AccessTokenCredential bearer = identity.getCredential(AccessTokenCredential.class);
        if (bearer == null || identity.getCredential(IdTokenCredential.class) != null) {
            return Uni.createFrom().item(identity);
        }
        // A bearer request from here on. Fail closed: an opaque token, verified by introspection,
        // has no claims for this rule or VerifiedEmail's to check.
        if (!(identity.getPrincipal() instanceof JsonWebToken token)) {
            return refused("The bearer token is not an ID token.");
        }
        if (saysItIsAnAccessToken(token)) {
            return refused("The bearer token is an access token, not an ID token.");
        }
        String tenant = identity.getAttribute(OidcUtils.TENANT_ID_ATTRIBUTE);
        if (!tenantNamesItsAudience.test(tenant) && !issuedTo(token, clientIdOfTenant.apply(tenant))) {
            return refused("The token was issued to another application.");
        }
        return Uni.createFrom().item(QuarkusSecurityIdentity.builder(identity)
            .addCredential(new IdTokenCredential(bearer.getToken()))
            .build());
    }

    private static Uni<SecurityIdentity> refused(String reason) {
        return Uni.createFrom().failure(new AuthenticationFailedException(reason));
    }

    private static boolean issuedTo(JsonWebToken token, String clientId) {
        Set<String> audience = token.getAudience();
        return clientId != null && audience != null && audience.contains(clientId);
    }

    /**
     * Whether a token declares itself an access token: Keycloak's {@code typ} other than
     * {@code ID}, or Cognito's {@code token_use} other than {@code id}. Google's ID tokens carry
     * neither, so a token saying nothing is taken at its audience's word.
     */
    private static boolean saysItIsAnAccessToken(JsonWebToken token) {
        return declaresOtherThan(token.getClaim(TYPE), ID_TYPE)
            || declaresOtherThan(token.getClaim(TOKEN_USE), ID_TYPE);
    }

    private static boolean declaresOtherThan(Object value, String expected) {
        return value != null && !expected.equalsIgnoreCase(value.toString());
    }

    /**
     * @param config the application's configuration
     * @param tenant a tenant id as Quarkus records it, {@code Default} for the main provider
     * @return that tenant's client id, or null when it has none
     */
    static String clientId(Config config, String tenant) {
        return config.getOptionalValue(prefix(tenant) + "client-id", String.class).orElse(null);
    }

    /**
     * @param config the application's configuration
     * @param tenant a tenant id as Quarkus records it
     * @return whether the tenant configures the audiences it accepts, which Quarkus then checks --
     *     not so for {@code any}, with which Quarkus checks nothing
     */
    static boolean namesItsAudience(Config config, String tenant) {
        return config.getOptionalValues(prefix(tenant) + "token.audience", String.class)
            .filter(audience -> !audience.contains(ANY_AUDIENCE))
            .isPresent();
    }

    private static String prefix(String tenant) {
        return tenant == null || OidcUtils.DEFAULT_TENANT_ID.equals(tenant) ? OIDC : OIDC + tenant + ".";
    }
}
