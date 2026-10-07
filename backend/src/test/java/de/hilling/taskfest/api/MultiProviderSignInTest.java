package de.hilling.taskfest.api;

import de.hilling.taskfest.support.KeycloakLoginFlow;
import de.hilling.taskfest.support.TwoSignInProviders;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import java.util.Map;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.startsWith;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * Two sign-in providers live at once (#143): the default one at {@code /api/auth/login}, and a
 * second, named one at {@code /api/auth/login/other}, each a Keycloak realm of its own.
 *
 * <p>In qa the second provider is a Cognito pool with test accounts (#190); here it is a second
 * realm in the Keycloak Dev Services starts, so the whole behaviour -- sign-in per provider, the
 * session kept per provider, and one provider's session never passing for another's -- is proven
 * locally, with no AWS. The profile declares the provider exactly as a deployment would: a named
 * Quarkus OIDC tenant and its {@code taskfest.auth.providers} entry, and nothing in code.</p>
 */
@QuarkusTest
@TestProfile(TwoSignInProviders.class)
class MultiProviderSignInTest {

    /** Quarkus OIDC's status for "you need to authenticate, but you asked me not to redirect". */
    private static final int REDIRECT_SUPPRESSED = 499;

    private static final String OTHER_LOGIN = TwoSignInProviders.OTHER_LOGIN;

    @Test
    void shouldOfferBothProvidersEachWithItsOwnSignInPath() {
        given()
            .when().get("/api/auth/providers")
            .then()
            .statusCode(200)
            .body("providers.find { it.id == 'keycloak' }.loginUrl", equalTo("/api/auth/login"))
            .body("providers.find { it.id == 'other' }.label", equalTo("Other"))
            .body("providers.find { it.id == 'other' }.available", equalTo(true))
            .body("providers.find { it.id == 'other' }.loginUrl", equalTo(OTHER_LOGIN));
    }

    @Test
    void shouldSignInThroughTheSecondProvider() {
        KeycloakLoginFlow ola = new KeycloakLoginFlow();
        ola.signIn(OTHER_LOGIN, "ola", "ola");

        ola.authenticated()
            .header("X-Requested-With", "JavaScript")
            .when().get("/api/auth/me")
            .then()
            .statusCode(200)
            .body("email", equalTo("ola@example.org"));
    }

    @Test
    void shouldKeepTheSecondProvidersSessionInItsOwnCookie() {
        KeycloakLoginFlow ola = new KeycloakLoginFlow();
        ola.signIn(OTHER_LOGIN, "ola", "ola");

        // Quarkus names a tenant's session cookie after the tenant; that is what lets the next
        // request find its way back to the provider that issued it.
        assertThat(ola.sessionCookieNames(), hasItem(startsWith("q_session_other")));
    }

    @Test
    void shouldStillSignInThroughTheDefaultProvider() {
        KeycloakLoginFlow gunnar = new KeycloakLoginFlow();
        gunnar.signIn("gunnar", "gunnar");

        gunnar.authenticated()
            .header("X-Requested-With", "JavaScript")
            .when().get("/api/auth/me")
            .then()
            .statusCode(200)
            .body("email", equalTo("jboss.gunnar@hilling.de"));
    }

    @Test
    void shouldNotLetOneProvidersSessionPassForAnothers() {
        KeycloakLoginFlow ola = new KeycloakLoginFlow();
        ola.signIn(OTHER_LOGIN, "ola", "ola");

        // The second provider's session, presented under the default provider's cookie name. A
        // session is encrypted with its own tenant's secret, so the default tenant must not be
        // able to read it -- and must not mistake it for a session of its own.
        Map<String, String> renamed = Map.of("q_session", ola.sessionCookies().entrySet().stream()
            .filter(cookie -> cookie.getKey().startsWith("q_session_other"))
            .findFirst().orElseThrow().getValue());

        given()
            .cookies(renamed)
            .header("X-Requested-With", "JavaScript")
            .redirects().follow(false)
            .when().get("/api/auth/me")
            .then()
            .statusCode(REDIRECT_SUPPRESSED);
    }

    @Test
    void shouldEndBothSessionsOnSignOut() {
        KeycloakLoginFlow both = new KeycloakLoginFlow();
        both.signIn("gunnar", "gunnar");
        both.signIn(OTHER_LOGIN, "ola", "ola");

        both.signOut();

        assertThat(both.sessionCookieNames(), empty());
    }

    @Test
    void shouldRefuseAnAccountWhoseEmailIsNotVerified() {
        // The email is the identity (D1 on #141): a provider that cannot vouch for the address
        // must not be able to sign anyone in as its owner.
        KeycloakLoginFlow unverified = new KeycloakLoginFlow();

        IllegalStateException refused = assertThrows(IllegalStateException.class,
            () -> unverified.signIn(OTHER_LOGIN, "unverified", "unverified"));

        assertThat(refused.getMessage(), containsString("status 401"));
    }
}
