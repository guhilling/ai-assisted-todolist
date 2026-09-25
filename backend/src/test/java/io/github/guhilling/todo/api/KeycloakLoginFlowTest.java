package io.github.guhilling.todo.api;

import io.github.guhilling.todo.support.KeycloakLoginFlow;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import io.restassured.http.ContentType;
import java.time.LocalDate;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.matchesPattern;
import static org.hamcrest.Matchers.not;

/**
 * Exercises the sign-in path that production actually uses -- the OIDC authorization code
 * flow with a browser session -- against the Keycloak started by Dev Services.
 *
 * <p>{@link TaskResourceTest} covers the same endpoints with a faked identity
 * ({@code @TestSecurity}); this test complements it by proving that the flow itself works
 * end to end for the local accounts {@code gunnar} and {@code lasse}.</p>
 */
@QuarkusTest
@TestProfile(KeycloakLoginFlowTest.LocalAuthProfile.class)
class KeycloakLoginFlowTest {

    /** Quarkus OIDC's status for "you need to authenticate, but you asked me not to redirect". */
    private static final int REDIRECT_SUPPRESSED = 499;

    private static final String GUNNAR_EMAIL = "gunnar@example.com";

    @Test
    void shouldOfferKeycloakAsAnAvailableProvider() {
        given()
            .when().get("/api/auth/providers")
            .then()
            .statusCode(200)
            .body("enabled", equalTo(true))
            .body("providers.find { it.id == 'keycloak' }.label", equalTo("Keycloak"))
            .body("providers.find { it.id == 'keycloak' }.available", equalTo(true))
            .body("providers.find { it.id == 'keycloak' }.loginUrl", equalTo("/api/auth/login"));
    }

    @Test
    void shouldSendAnAlreadySignedInVisitorBackToTheApp() {
        KeycloakLoginFlow gunnar = new KeycloakLoginFlow();
        gunnar.signIn("gunnar", "gunnar");

        // Hitting /login while a session already exists is the one way to reach the method
        // body: on a first visit the security layer intercepts the request and starts the
        // authorization code flow long before the resource is called. What it proves is that
        // todo.post-login-redirect-uri is where the browser ends up.
        gunnar.authenticated()
            .redirects().follow(false)
            .when().get("/api/auth/login")
            .then()
            .statusCode(303)
            // seeOther resolves the configured relative URI against the request, so what
            // arrives is the absolute form of "/" -- the app's own root, whatever the port.
            .header("Location", matchesPattern("https?://[^/]+/"));
    }

    @Test
    void shouldSignGunnarInThroughTheAuthorizationCodeFlow() {
        KeycloakLoginFlow gunnar = new KeycloakLoginFlow();
        gunnar.signIn("gunnar", "gunnar");

        gunnar.authenticated()
            .header("X-Requested-With", "JavaScript")
            .when().get("/api/auth/me")
            .then()
            .statusCode(200)
            .body("email", equalTo(GUNNAR_EMAIL));
    }

    @Test
    void shouldKeepTasksOfTheTwoLocalAccountsApart() {
        String description = "Prepare the demo " + UUID.randomUUID();

        KeycloakLoginFlow gunnar = new KeycloakLoginFlow();
        gunnar.signIn("gunnar", "gunnar");
        gunnar.authenticated()
            .contentType(ContentType.JSON)
            .body(Map.of(
                "description", description,
                "dueDate", LocalDate.now().plusDays(2).toString(),
                "importance", "MEDIUM",
                "state", "TODO"))
            .when().post("/api/tasks")
            .then()
            .statusCode(201);

        gunnar.authenticated()
            .when().get("/api/tasks")
            .then()
            .statusCode(200)
            .body("description", hasItem(description));

        KeycloakLoginFlow lasse = new KeycloakLoginFlow();
        lasse.signIn("lasse", "lasse");
        lasse.authenticated()
            .when().get("/api/tasks")
            .then()
            .statusCode(200)
            .body("description", not(hasItem(description)));
    }

    /**
     * Turns the provider list on the way local development does, without disturbing the
     * {@code %test} defaults the other test classes rely on.
     */
    @Test
    void shouldEndTheSessionOnSignOutEvenWhenTheCookieIsChunked() {
        KeycloakLoginFlow flow = new KeycloakLoginFlow();
        flow.signIn("gunnar", "gunnar");

        // Quarkus splits the session cookie into q_session_chunk_N once it outgrows 4 KB, and
        // whether it does depends on how big the tokens happen to be. Sign-out has to clear
        // whatever it actually finds, so assert the shape we got before relying on it.
        assertThat(flow.sessionCookieNames(), not(empty()));

        flow.signOut();

        assertThat(flow.sessionCookieNames(), empty());
        // X-Requested-With is how the single-page app probes the session: it stops the backend
        // redirecting a background request off to the identity provider, and Quarkus answers
        // with its "authentication required, redirect suppressed" status instead. The frontend
        // reads anything that is not 2xx here as "nobody is signed in".
        flow.authenticated()
            .header("X-Requested-With", "JavaScript")
            .redirects().follow(false)
            .when().get("/api/auth/me")
            .then()
            .statusCode(REDIRECT_SUPPRESSED);
    }

    public static class LocalAuthProfile implements QuarkusTestProfile {

        @Override
        public Map<String, String> getConfigOverrides() {
            return Map.of("todo.auth.enabled", "true");
        }
    }
}
