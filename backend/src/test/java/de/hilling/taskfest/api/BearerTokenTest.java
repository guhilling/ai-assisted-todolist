package de.hilling.taskfest.api;

import de.hilling.taskfest.model.TaskImportance;
import de.hilling.taskfest.model.TaskState;
import de.hilling.taskfest.support.KeycloakTokens;
import de.hilling.taskfest.support.TwoSignInProviders;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.http.ContentType;
import io.restassured.response.ValidatableResponse;
import io.restassured.specification.RequestSpecification;
import java.time.Duration;
import java.time.LocalDate;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.awaitility.Awaitility.await;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.nullValue;

/**
 * The app's way in (#266): an ID token sent as {@code Authorization: Bearer}, beside the session
 * cookie the website uses.
 *
 * <p>In {@link TwoSignInProviders}, shared with the other multi-provider tests so Quarkus and
 * Keycloak boot once: the main provider (the {@code taskfest} realm, standing in for Google) and
 * the {@code apps} realm's tenant, standing in for qa's Cognito pool, whose client is public, as
 * an installed app's is.
 * Every refusal is a 401 -- never the redirect into a sign-in page that a browser would get, and
 * never a session cookie.</p>
 */
@QuarkusTest
@TestProfile(TwoSignInProviders.class)
class BearerTokenTest {

    private static final String WWW_AUTHENTICATE = "WWW-Authenticate";

    @Test
    void shouldSignGunnarInWithAnIdTokenFromTheMainProvider() {
        withBearer(gunnarsIdToken())
            .when().get("/api/auth/me")
            .then()
            .statusCode(200)
            .body("email", equalTo("gunnar@example.com"));
    }

    @Test
    void shouldLetABearerTokenWorkWithTasksLikeASession() {
        String token = gunnarsIdToken();
        String description = "Filed from the app " + UUID.randomUUID();

        withBearer(token)
            .contentType(ContentType.JSON)
            .body(Map.of(
                "description", description,
                "dueDate", LocalDate.now().plusDays(1).toString(),
                "importance", TaskImportance.HIGH.name(),
                "state", TaskState.TODO.name()))
            .when().post("/api/tasks")
            .then()
            .statusCode(201);

        withBearer(token)
            .when().get("/api/tasks")
            .then()
            .statusCode(200)
            .body("description", hasItem(description));
    }

    @Test
    void shouldResolveAFurtherProvidersTokenByItsIssuer() {
        withBearer(appToken("taskfest-app", "ada"))
            .when().get("/api/auth/me")
            .then()
            .statusCode(200)
            .body("email", equalTo("ada@example.org"));
    }

    @Test
    void shouldKeepTheAccountsOfBothProvidersApart() {
        String description = "Only Ada's " + UUID.randomUUID();
        withBearer(appToken("taskfest-app", "ada"))
            .contentType(ContentType.JSON)
            .body(Map.of(
                "description", description,
                "dueDate", LocalDate.now().plusDays(1).toString(),
                "importance", TaskImportance.LOW.name(),
                "state", TaskState.TODO.name()))
            .when().post("/api/tasks")
            .then()
            .statusCode(201);

        withBearer(gunnarsIdToken())
            .when().get("/api/tasks")
            .then()
            .statusCode(200)
            .body("description", not(hasItem(description)));
    }

    @Test
    void shouldLetAnAppDeleteItsUsersAccount() {
        // The app's account sheet (#275): the same endpoint the website uses, by bearer token.
        String token = appToken("taskfest-app", "ada");
        String description = "Gone with the account " + UUID.randomUUID();
        withBearer(token)
            .contentType(ContentType.JSON)
            .body(Map.of(
                "description", description,
                "dueDate", LocalDate.now().plusDays(1).toString(),
                "importance", TaskImportance.LOW.name(),
                "state", TaskState.TODO.name()))
            .when().post("/api/tasks")
            .then()
            .statusCode(201);

        withBearer(token)
            .when().delete("/api/account")
            .then()
            .statusCode(204)
            .header("Set-Cookie", nullValue());

        withBearer(token)
            .when().get("/api/tasks")
            .then()
            .statusCode(200)
            .body("description", not(hasItem(description)));
    }

    @Test
    void shouldRefuseATokenIssuedToAnotherApplication() {
        // Same provider, same user, but issued to someone else's client: anyone holding a token
        // from that application could otherwise replay it here as its user.
        refused(withBearer(appToken("someone-else", "ada")).when().get("/api/auth/me").then());
    }

    @Test
    void shouldRefuseATokenWhoseEmailIsNotVerified() {
        refused(withBearer(appToken("taskfest-app", "unverified")).when().get("/api/auth/me").then());
    }

    @Test
    void shouldRefuseATokenWithABrokenSignature() {
        refused(withBearer(withAlteredPayload(gunnarsIdToken())).when().get("/api/auth/me").then());
    }

    @Test
    void shouldRefuseAnExpiredToken() {
        // The brief realm issues tokens for three seconds, so this one is soon out of date.
        String token = KeycloakTokens.idToken("brief", "taskfest-app", null, "ada", "ada");

        await().atMost(Duration.ofSeconds(30)).pollInterval(Duration.ofSeconds(1)).untilAsserted(() ->
            refused(withBearer(token).when().get("/api/auth/me").then()));
    }

    @Test
    void shouldStillAnswerABrowserWithoutAnyTokenAsBefore() {
        // The website's background requests carry X-Requested-With and no token; they keep
        // getting Quarkus' "redirect suppressed" answer, which the frontend reads as signed out.
        given()
            .header("X-Requested-With", "JavaScript")
            .redirects().follow(false)
            .when().get("/api/auth/me")
            .then()
            .statusCode(499);
    }

    private static RequestSpecification withBearer(String token) {
        return given()
            .auth().oauth2(token)
            .redirects().follow(false);
    }

    /** A refusal fit for an app: 401, no way into a sign-in page, and no session started. */
    private static void refused(ValidatableResponse response) {
        response
            .statusCode(401)
            .header("Location", nullValue())
            .header("Set-Cookie", nullValue())
            .header(WWW_AUTHENTICATE, not(nullValue()));
    }

    private static String gunnarsIdToken() {
        return KeycloakTokens.idToken("taskfest", "taskfest-backend", "taskfest-secret", "gunnar", "gunnar");
    }

    private static String appToken(String clientId, String username) {
        return KeycloakTokens.idToken("apps", clientId, null, username, username);
    }

    /** The same token with one claim changed, so its signature no longer matches. */
    private static String withAlteredPayload(String token) {
        String[] parts = token.split("\\.");
        Base64.Decoder decoder = Base64.getUrlDecoder();
        String payload = new String(decoder.decode(parts[1]))
            .replace("gunnar@example.com", "lasse@example.com");
        String altered = Base64.getUrlEncoder().withoutPadding().encodeToString(payload.getBytes());
        return parts[0] + "." + altered + "." + parts[2];
    }
}
