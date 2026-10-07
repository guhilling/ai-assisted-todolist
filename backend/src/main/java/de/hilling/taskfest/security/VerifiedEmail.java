package de.hilling.taskfest.security;

import io.quarkus.security.AuthenticationFailedException;
import io.quarkus.security.identity.AuthenticationRequestContext;
import io.quarkus.security.identity.SecurityIdentity;
import io.quarkus.security.identity.SecurityIdentityAugmentor;
import io.smallrye.mutiny.Uni;
import jakarta.enterprise.context.ApplicationScoped;
import org.eclipse.microprofile.jwt.Claims;
import org.eclipse.microprofile.jwt.JsonWebToken;

/**
 * Refuses a sign-in whose provider has not verified the email address (#143).
 *
 * <p>The email is this application's whole notion of identity: it is what a {@code User} is
 * keyed by and what ownership is decided on. With more than one provider live, the same address
 * from either means the same person -- so a provider that could hand out an address it never
 * checked could sign someone in as another person's account. Every provider must therefore vouch
 * for the address, through the OpenID Connect claim {@code email_verified}.</p>
 *
 * <p>Quarkus can require a claim by configuration ({@code token.required-claims}), but only with
 * a string value, and Google and Keycloak send this one as a boolean, so every real sign-in was
 * refused. The rule lives here instead, for every tenant at once.</p>
 *
 * <p>Only identities carried by a token are checked. One without -- anonymous, or the faked
 * identities of {@code @TestSecurity} -- has no provider to have verified anything.</p>
 */
@ApplicationScoped
public class VerifiedEmail implements SecurityIdentityAugmentor {

    private static final String EMAIL_VERIFIED = Claims.email_verified.name();

    @Override
    public Uni<SecurityIdentity> augment(SecurityIdentity identity, AuthenticationRequestContext context) {
        if (identity.isAnonymous() || !(identity.getPrincipal() instanceof JsonWebToken token)) {
            return Uni.createFrom().item(identity);
        }
        if (!claims(token.getClaim(EMAIL_VERIFIED))) {
            return Uni.createFrom().failure(new AuthenticationFailedException(
                "The identity provider has not verified this email address."));
        }
        return Uni.createFrom().item(identity);
    }

    /**
     * Whether a value of the {@code email_verified} claim says the address is verified.
     *
     * <p>A boolean from Google and Keycloak, the string {@code "true"} from some Cognito tokens;
     * anything else, a missing claim included, is a no.</p>
     *
     * @param value the claim's value, or null when the token does not carry it
     * @return true only for a verified address
     */
    static boolean claims(Object value) {
        if (value instanceof Boolean verified) {
            return verified;
        }
        return value instanceof String text && Boolean.parseBoolean(text);
    }
}
