package de.hilling.taskfest.security;

import io.quarkus.security.AuthenticationFailedException;
import io.quarkus.security.identity.SecurityIdentity;
import io.quarkus.security.runtime.QuarkusSecurityIdentity;
import java.util.Map;
import java.util.Set;
import org.eclipse.microprofile.jwt.JsonWebToken;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Which values of the {@code email_verified} claim count as a verified address (#143).
 *
 * <p>A plain unit test, because the rule is about a claim's value and nothing else. Providers
 * disagree on the type: Google and Keycloak send a boolean, Cognito has sent the string
 * {@code "true"}. Quarkus' own {@code required-claims} accepts strings only and so refused every
 * real sign-in, which is why the rule lives here.</p>
 */
class VerifiedEmailTest {

    @Test
    void shouldAcceptTheBooleanTrue() {
        assertTrue(VerifiedEmail.claims(Boolean.TRUE));
    }

    @Test
    void shouldAcceptTheStringTrueInAnyCase() {
        assertTrue(VerifiedEmail.claims("true"));
        assertTrue(VerifiedEmail.claims("TRUE"));
    }

    @Test
    void shouldRefuseFalse() {
        assertFalse(VerifiedEmail.claims(Boolean.FALSE));
        assertFalse(VerifiedEmail.claims("false"));
    }

    @Test
    void shouldRefuseAMissingClaim() {
        // A provider that says nothing about the address has not vouched for it.
        assertFalse(VerifiedEmail.claims(null));
    }

    @Test
    void shouldRefuseAnythingElse() {
        assertFalse(VerifiedEmail.claims("yes"));
        assertFalse(VerifiedEmail.claims(1));
    }

    @Test
    void shouldLetAVerifiedIdentityThrough() {
        SecurityIdentity identity = identityWith(Map.of("email_verified", true));

        assertSame(identity, augmented(identity));
    }

    @Test
    void shouldRefuseAnIdentityWhoseAddressIsNotVerified() {
        SecurityIdentity identity = identityWith(Map.of("email_verified", false));

        assertThrows(AuthenticationFailedException.class, () -> augmented(identity));
    }

    @Test
    void shouldLeaveAnIdentityWithoutATokenAlone() {
        // Anonymous, or faked by @TestSecurity: no provider stands behind it to have verified anything.
        SecurityIdentity named = QuarkusSecurityIdentity.builder().setPrincipal(() -> "alice").build();

        assertSame(named, augmented(named));
    }

    private static SecurityIdentity augmented(SecurityIdentity identity) {
        return new VerifiedEmail().augment(identity, null).await().indefinitely();
    }

    private static SecurityIdentity identityWith(Map<String, Object> claims) {
        return QuarkusSecurityIdentity.builder().setPrincipal(new StubToken(claims)).build();
    }

    /** The claims of an ID token, and nothing else a token has. */
    private record StubToken(Map<String, Object> claims) implements JsonWebToken {

        @Override
        public String getName() {
            return "sub-1";
        }

        @Override
        public Set<String> getClaimNames() {
            return claims.keySet();
        }

        @Override
        @SuppressWarnings("unchecked")
        public <T> T getClaim(String claimName) {
            return (T) claims.get(claimName);
        }
    }
}
