package de.hilling.taskfest.api;

import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;

/**
 * Pins down the oldest app release a deployment serves when nothing overrides it: 1.4.0 since #475.
 * An app before it does not send a task's due time and time zone back, so any change it made would
 * erase them; lowering this again would let such an app back in.
 */
@QuarkusTest
class MinimumAppVersionDefaultTest {

    @Test
    void shouldServeNoAppThatWouldEraseADueTime() {
        given()
            .when().get("/api/version")
            .then()
            .statusCode(200)
            .body("minimumAppVersion", equalTo("1.4.0"));
    }
}
