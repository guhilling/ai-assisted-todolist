package de.hilling.taskfest.api;

import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;

/**
 * Checks the readiness endpoint the load balancer's health check calls, against Dev Services.
 *
 * <p>Like {@code /q/metrics}, it comes from an extension and configuration rather than code of
 * ours, so this is what would notice it disappearing. It also pins that readiness includes the
 * database: a check that stayed green while the database was unreachable would keep a task in
 * the target group that can only answer with errors.</p>
 */
@QuarkusTest
class HealthResourceTest {

    @Test
    void shouldReportReadyIncludingTheDatabase() {
        given()
            .when().get("/q/health/ready")
            .then()
            .statusCode(200)
            .body("status", equalTo("UP"))
            .body("checks.name", hasItem("Database connections health check"));
    }
}
