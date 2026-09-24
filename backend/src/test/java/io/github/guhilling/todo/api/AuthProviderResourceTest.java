package io.github.guhilling.todo.api;

import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
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
            .body("providers.size()", equalTo(4))
            .body("providers.find { it.id == 'google' }.label", equalTo("Google"))
            .body("providers.find { it.id == 'google' }.available", equalTo(false))
            .body("providers.find { it.id == 'google' }.loginUrl", equalTo(null));
    }
}
