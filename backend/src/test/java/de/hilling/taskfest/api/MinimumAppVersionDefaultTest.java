package de.hilling.taskfest.api;

import io.quarkus.test.junit.QuarkusTest;
import java.util.Arrays;
import java.util.Comparator;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Pins down that a deployment, unless told otherwise, serves no app older than 1.4.0 (#475). An app
 * before it does not send a task's due time and time zone back, so any change it made would erase
 * them. A later raise passes; only lowering it below 1.4.0 fails.
 */
@QuarkusTest
class MinimumAppVersionDefaultTest {

    private static final String FIRST_TO_KEEP_DUE_TIMES = "1.4.0";

    private static final Comparator<String> RELEASES = Comparator.comparing(
        release -> Arrays.stream(release.split("\\.")).mapToInt(Integer::parseInt).toArray(),
        Arrays::compare);

    @Test
    void shouldServeNoAppThatWouldEraseADueTime() {
        String minimum = given()
            .when().get("/api/version")
            .then()
            .statusCode(200)
            .extract().path("minimumAppVersion");

        assertTrue(RELEASES.compare(minimum, FIRST_TO_KEEP_DUE_TIMES) >= 0,
            () -> minimum + " lets in apps that erase due times");
    }
}
