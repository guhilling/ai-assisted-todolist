package io.github.guhilling.todo.api;

import io.quarkus.test.junit.QuarkusIntegrationTest;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.not;

/**
 * Smoke-tests the packaged artifact rather than the in-JVM application.
 *
 * <p>This is the only test that exercises a real built runner, which is why it is kept
 * deliberately thin. It is skipped by default: {@code pom.xml} sets {@code skipITs} to
 * true, and the {@code native} profile is what turns it back on.</p>
 */
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
