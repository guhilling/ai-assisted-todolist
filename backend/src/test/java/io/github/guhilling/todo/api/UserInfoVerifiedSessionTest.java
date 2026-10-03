package io.github.guhilling.todo.api;

import io.github.guhilling.todo.support.KeycloakLoginFlow;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import java.util.Map;
import org.junit.jupiter.api.Test;

import static org.hamcrest.Matchers.equalTo;

/**
 * Signs in for real against Keycloak with the access-token setting production uses for Google,
 * and checks the session still works afterwards.
 *
 * <p>Google's access tokens are opaque, so {@code %prod} and {@code %qa} verify them against the
 * UserInfo endpoint ({@code quarkus.oidc.token.verify-access-token-with-user-info}); without it,
 * every Google sign-in failed on the way back. Keycloak's tokens are JWTs, so this cannot show
 * the original failure — only qa can — but it does pin that the setting keeps the sign-in and
 * the restored session working, which nothing else here exercises.</p>
 */
@QuarkusTest
@TestProfile(UserInfoVerifiedSessionTest.VerifiedWithUserInfo.class)
class UserInfoVerifiedSessionTest {

    @Test
    void shouldKeepTheSessionWhenAccessTokensAreVerifiedWithUserInfo() {
        KeycloakLoginFlow gunnar = new KeycloakLoginFlow();
        gunnar.signIn("gunnar", "gunnar");

        gunnar.authenticated()
            .header("X-Requested-With", "JavaScript")
            .when().get("/api/auth/me")
            .then()
            .statusCode(200)
            .body("email", equalTo("jboss.gunnar@hilling.de"));
    }

    /** Sign-in on, and access tokens verified the way production verifies Google's. */
    public static class VerifiedWithUserInfo implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            return Map.of(
                "todo.auth.enabled", "true",
                "quarkus.oidc.token.verify-access-token-with-user-info", "true");
        }
    }
}
