package de.hilling.taskfest.api;

import de.hilling.taskfest.support.KeycloakLoginFlow;
import de.hilling.taskfest.support.TwoSignInProviders;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import java.util.HashMap;
import java.util.Map;
import org.eclipse.microprofile.config.Config;
import org.eclipse.microprofile.config.ConfigProvider;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.everyItem;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;
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
            .body("email", equalTo("gunnar@example.com"));
    }

    @Test
    void shouldNotLetOneProvidersSessionPassForAnothers() {
        KeycloakLoginFlow ola = new KeycloakLoginFlow();
        ola.signIn(OTHER_LOGIN, "ola", "ola");

        // The second provider's whole session -- every chunk, so the value is complete -- presented
        // under the main provider's cookie names. A session is encrypted with its own tenant's
        // secret, so the main tenant must not be able to read it, and must not mistake it for one
        // of its own.
        Map<String, String> renamed = new HashMap<>();
        ola.sessionCookies().forEach((name, value) -> renamed.put(name.replace("q_session_other", "q_session"), value));
        assertThat(renamed.keySet(), hasItem(startsWith("q_session")));

        given()
            .cookies(renamed)
            .header("X-Requested-With", "JavaScript")
            .redirects().follow(false)
            .when().get("/api/auth/me")
            .then()
            .statusCode(REDIRECT_SUPPRESSED);
    }

    @Test
    void shouldEndTheSecondProvidersSessionOnSignOut() {
        KeycloakLoginFlow ola = new KeycloakLoginFlow();
        ola.signIn(OTHER_LOGIN, "ola", "ola");

        ola.signOut();

        assertThat(ola.sessionCookieNames(), empty());
    }

    @Test
    void shouldKeepOneProviderSignedInAtATime() {
        // A browser holding two providers' sessions would be one person or the other depending on
        // which cookie Quarkus looked at first. Signing in with one provider ends the other's.
        KeycloakLoginFlow browser = new KeycloakLoginFlow();
        browser.signIn("gunnar", "gunnar");
        browser.signIn(OTHER_LOGIN, "ola", "ola");
        // Where Quarkus sends the browser once the sign-in has completed: back to the path that
        // started it, whose body hands over to the app.
        browser.visit(OTHER_LOGIN);

        assertThat(browser.sessionCookieNames(), everyItem(startsWith("q_session_other")));
        assertThat(emailOf(browser), equalTo("ola@example.org"));

        browser.signIn("gunnar", "gunnar");
        browser.visit("/api/auth/login");

        assertThat(browser.sessionCookieNames(), everyItem(not(startsWith("q_session_other"))));
        assertThat(emailOf(browser), equalTo("gunnar@example.com"));
    }

    @Test
    void shouldSignInThroughTheSecondProviderAfterAnAbandonedSignInWithTheFirst() {
        // Someone clicked the main provider, went back, and chose the other one: the main
        // provider's state cookie is still there when the other provider's callback arrives.
        KeycloakLoginFlow browser = new KeycloakLoginFlow();
        browser.startSignIn("/api/auth/login");

        browser.signIn(OTHER_LOGIN, "ola", "ola");
        browser.visit(OTHER_LOGIN);

        assertThat(emailOf(browser), equalTo("ola@example.org"));
    }

    @Test
    void shouldRefuseAnUnknownProviderBeforeSigningAnyoneIn() {
        // Without this, an id that names no provider would fall through to the main provider's
        // sign-in: a stale link would sign someone in through a provider they did not choose.
        given()
            .redirects().follow(false)
            .when().get("/api/auth/login/no-such-provider")
            .then()
            .statusCode(404);
    }

    @Test
    void shouldShareEverySettingWithTheMainProvider() {
        // A named tenant inherits nothing, so each shared setting is repeated for it; a forgotten
        // one fails silently -- cookie-force-secure, say, and the session travels without Secure.
        Config config = ConfigProvider.getConfig();
        for (String setting : TwoSignInProviders.SHARED_SETTINGS) {
            assertThat(setting, config.getOptionalValue("quarkus.oidc.other." + setting, String.class),
                equalTo(config.getOptionalValue("quarkus.oidc." + setting, String.class)));
        }
    }

    private static String emailOf(KeycloakLoginFlow browser) {
        return browser.authenticated()
            .header("X-Requested-With", "JavaScript")
            .when().get("/api/auth/me")
            .then()
            .statusCode(200)
            .extract().path("email");
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
