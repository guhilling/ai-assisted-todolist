package io.github.guhilling.todo.api;

import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.equalTo;

@QuarkusTest
class AuthProviderResourceTest {

    @Test
    void shouldExposeOidcProviderPlaceholders() {
        given()
            .when().get("/api/auth/providers")
            .then()
            .statusCode(200)
            .body("enabled", equalTo(false))
            .body("providers.id", contains("google", "keycloak"))
            .body("providers.find { it.id == 'google' }.label", equalTo("Google"))
            .body("providers.find { it.id == 'google' }.available", equalTo(false))
            .body("providers.find { it.id == 'google' }.loginUrl", equalTo(null));
    }

    @Test
    void shouldNotOfferAProviderWhileAuthenticationIsDisabled() {
        given()
            .when().get("/api/auth/providers")
            .then()
            .statusCode(200)
            .body("providers.available", contains(false, false))
            .body("providers.loginUrl", contains(null, null));
    }
}
