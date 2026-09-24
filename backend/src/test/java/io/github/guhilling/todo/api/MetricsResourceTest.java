package io.github.guhilling.todo.api;

import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;

@QuarkusTest
class MetricsResourceTest {

    @Test
    void shouldExposePrometheusMetrics() {
        given()
            .when().get("/q/metrics")
            .then()
            .statusCode(200)
            .body(containsString("jvm_gc_pause_seconds"));
    }
}
