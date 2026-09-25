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
            // jvm_memory_used_bytes exists from startup. jvm_gc_pause_seconds was the earlier
            // witness, but Micrometer only registers that timer once a garbage collection has
            // actually happened, so the test passed or failed depending on where it landed in
            // the run -- and it was never about garbage collection anyway.
            .body(containsString("jvm_memory_used_bytes"));
    }
}
