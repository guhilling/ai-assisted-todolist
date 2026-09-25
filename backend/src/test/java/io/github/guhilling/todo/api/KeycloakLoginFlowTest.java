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
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
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
    public static class LocalAuthProfile implements QuarkusTestProfile {

        @Override
        public Map<String, String> getConfigOverrides() {
            return Map.of("todo.auth.enabled", "true");
        }
    }
}
