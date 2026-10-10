package de.hilling.taskfest.security;

import io.quarkus.oidc.AccessTokenCredential;
import io.quarkus.oidc.IdTokenCredential;
import io.quarkus.security.AuthenticationFailedException;
import io.quarkus.security.identity.SecurityIdentity;
import io.quarkus.security.runtime.QuarkusSecurityIdentity;
import io.smallrye.config.SmallRyeConfigBuilder;
import java.util.Map;
import java.util.Set;
import org.eclipse.microprofile.config.Config;
import org.eclipse.microprofile.jwt.JsonWebToken;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * How a bearer ID token from an app becomes an identity the resources can read (#266).
 *
 * <p>A plain unit test of the two rules {@link BearerIdToken} adds to what Quarkus checks: a
 * bearer token must have been issued to this deployment's own client, and once it has, it is
 * the identity's ID token -- the one {@code @IdToken} reads the claims from. The whole flow, with
 * real tokens from Keycloak, is {@code BearerTokenTest}.</p>
 */
class BearerIdTokenTest {

    private static final String DEFAULT_TENANT = "Default";

    private static final String RAW_TOKEN = "header.payload.signature";

    private final BearerIdToken bearerIdToken = new BearerIdToken(
        Map.of(DEFAULT_TENANT, "taskfest-backend", "cognito", "taskfest-cognito")::get,
        "google"::equals);

    @Test
    void shouldMakeABearerTokenForOurClientTheIdentitysIdToken() {
        SecurityIdentity augmented = augmented(bearerIdentity(DEFAULT_TENANT, Set.of("taskfest-backend")));

        assertEquals(RAW_TOKEN, augmented.getCredential(IdTokenCredential.class).getToken());
    }

    @Test
    void shouldCheckANamedTenantAgainstItsOwnClient() {
        SecurityIdentity augmented = augmented(bearerIdentity("cognito", Set.of("taskfest-cognito")));

        assertEquals(RAW_TOKEN, augmented.getCredential(IdTokenCredential.class).getToken());
    }

    @Test
    void shouldRefuseABearerTokenIssuedToAnotherClient() {
        SecurityIdentity identity = bearerIdentity(DEFAULT_TENANT, Set.of("someone-else"));

        assertThrows(AuthenticationFailedException.class, () -> augmented(identity));
    }

    @Test
    void shouldRefuseABearerTokenIssuedToAnotherTenantsClient() {
        SecurityIdentity identity = bearerIdentity("cognito", Set.of("taskfest-backend"));

        assertThrows(AuthenticationFailedException.class, () -> augmented(identity));
    }

    @Test
    void shouldRefuseABearerTokenWithoutAnAudience() {
        SecurityIdentity identity = bearerIdentity(DEFAULT_TENANT, null);

        assertThrows(AuthenticationFailedException.class, () -> augmented(identity));
    }

    @Test
    void shouldLeaveTheAudienceToQuarkusWhereTheTenantNamesItsOwn() {
        // A tenant with token.audience configured has had the audience checked by Quarkus
        // already, against a list that may hold more than the client id -- an iOS client's.
        SecurityIdentity augmented = augmented(bearerIdentity("google", Set.of("ios-client")));

        assertEquals(RAW_TOKEN, augmented.getCredential(IdTokenCredential.class).getToken());
    }

    @Test
    void shouldLeaveASessionIdentityAlone() {
        // The code flow already holds an ID token of its own.
        SecurityIdentity session = QuarkusSecurityIdentity.builder()
            .setPrincipal(new StubToken(Set.of("taskfest-backend")))
            .addCredential(new AccessTokenCredential("access"))
            .addCredential(new IdTokenCredential("id"))
            .addAttribute("tenant-id", DEFAULT_TENANT)
            .build();

        assertSame(session, augmented(session));
    }

    @Test
    void shouldLeaveAnIdentityWithoutATokenAlone() {
        SecurityIdentity named = QuarkusSecurityIdentity.builder().setPrincipal(() -> "alice").build();

        assertSame(named, augmented(named));
    }

    @Test
    void shouldReadEachTenantsClientFromConfiguration() {
        Config config = new SmallRyeConfigBuilder().withDefaultValues(Map.of(
            "quarkus.oidc.client-id", "taskfest-backend",
            "quarkus.oidc.cognito.client-id", "taskfest-cognito",
            "quarkus.oidc.cognito.token.audience", "taskfest-cognito,ios")).build();

        assertEquals("taskfest-backend", BearerIdToken.clientId(config, DEFAULT_TENANT));
        assertEquals("taskfest-cognito", BearerIdToken.clientId(config, "cognito"));
        assertTrue(BearerIdToken.namesItsAudience(config, "cognito"));
        assertFalse(BearerIdToken.namesItsAudience(config, DEFAULT_TENANT));
    }

    private SecurityIdentity augmented(SecurityIdentity identity) {
        return bearerIdToken.augment(identity, null).await().indefinitely();
    }

    private static SecurityIdentity bearerIdentity(String tenant, Set<String> audience) {
        return QuarkusSecurityIdentity.builder()
            .setPrincipal(new StubToken(audience))
            .addCredential(new AccessTokenCredential(RAW_TOKEN))
            .addAttribute("tenant-id", tenant)
            .build();
    }

    /** A verified token with an audience, and nothing else a token has. */
    private record StubToken(Set<String> audience) implements JsonWebToken {

        @Override
        public String getName() {
            return "sub-1";
        }

        @Override
        public Set<String> getAudience() {
            return audience;
        }

        @Override
        public Set<String> getClaimNames() {
            return Set.of();
        }

        @Override
        public <T> T getClaim(String claimName) {
            return null;
        }
    }
}
