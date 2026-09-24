package io.github.guhilling.todo.api;

import io.quarkus.test.junit.QuarkusIntegrationTest;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.not;

@QuarkusIntegrationTest
class TaskResourceIT {

    // @TestSecurity/@OidcSecurity only work in @QuarkusTest (in-JVM) mode, not in packaged
    // @QuarkusIntegrationTest mode, so only security-agnostic smoke checks run here.

    @Test
    void shouldRejectAnonymousRequests() {
        given()
            .header("X-Requested-With", "JavaScript")
            .when().get("/api/tasks")
            .then()
            .statusCode(not(200));
    }
}
