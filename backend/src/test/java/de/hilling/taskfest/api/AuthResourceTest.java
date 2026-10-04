package de.hilling.taskfest.api;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.security.TestSecurity;
import io.quarkus.test.security.oidc.Claim;
import io.quarkus.test.security.oidc.OidcSecurity;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.nullValue;

/**
 * Covers what {@code /api/auth/me} tells the browser about whoever is signed in.
 *
 * <p>Identity is faked with {@code @TestSecurity}, which is what makes it possible to vary the
 * claims: the point of these tests is that a provider may supply a name, a picture, both or
 * neither, and the response has to be honest about which. A real login could only ever exercise
 * whatever Keycloak happens to put in the token.</p>
 *
 * <p>Gravatar is switched off in the test profile, so the fallback here resolves to nothing
 * rather than reaching gravatar.com. That the lookup itself works is
 * {@code GravatarServiceTest}'s business, against a local server.</p>
 */
@QuarkusTest
class AuthResourceTest {

    private static final String ALICE = "alice@example.com";

    @Test
    @TestSecurity(user = ALICE)
    @OidcSecurity(claims = { @Claim(key = "email", value = ALICE) })
    void shouldReportTheEmailWhenThatIsAllTheProviderGave() {
        given()
            .when().get("/api/auth/me")
            .then()
            .statusCode(200)
            .body("email", equalTo(ALICE))
            .body("name", nullValue())
            .body("pictureUrl", nullValue());
    }

    @Test
    @TestSecurity(user = ALICE)
    @OidcSecurity(claims = {
        @Claim(key = "email", value = ALICE),
        @Claim(key = "name", value = "Alice Example")
    })
    void shouldPassOnTheDisplayName() {
        given()
            .when().get("/api/auth/me")
            .then()
            .statusCode(200)
            .body("name", equalTo("Alice Example"));
    }

    @Test
    @TestSecurity(user = ALICE)
    @OidcSecurity(claims = {
        @Claim(key = "email", value = ALICE),
        @Claim(key = "picture", value = "https://example.com/alice.png")
    })
    void shouldPreferThePictureTheProviderSupplied() {
        // With a picture in the token, Gravatar must not be consulted at all -- which is the
        // branch that keeps the common case off the network.
        given()
            .when().get("/api/auth/me")
            .then()
            .statusCode(200)
            .body("pictureUrl", equalTo("https://example.com/alice.png"));
    }

    @Test
    void shouldRefuseAnAnonymousCaller() {
        // not(200) rather than a specific code, matching TaskResourceTest: with authentication
        // switched off in this profile the rejection arrives as a 499 rather than a 401, and
        // what matters here is that an unauthenticated caller is not told who is signed in.
        given()
            .header("X-Requested-With", "JavaScript")
            .when().get("/api/auth/me")
            .then()
            .statusCode(not(200));
    }
}
