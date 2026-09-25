package io.github.guhilling.todo.api;

import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;

/**
 * Checks that the Prometheus scrape endpoint is actually exposed.
 *
 * <p>Micrometer contributes {@code /q/metrics} through configuration rather than through
 * any code of ours, so nothing else in the build would notice if a dependency or property
 * change silently switched it off.</p>
 */
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
