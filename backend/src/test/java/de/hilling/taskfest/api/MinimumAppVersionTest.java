package de.hilling.taskfest.api;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import java.util.Map;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;

/**
 * Pins down that a deployment tells the mobile app the oldest release it still serves (#268), so an
 * app older than that can ask its user to update rather than fail on an API it no longer matches.
 *
 * <p>Set by configuration, {@code taskfest.minimum-app-version}; raising it is the deliberate act
 * that goes with dropping what an old app needs. This profile sets it above the default, which
 * {@link MinimumAppVersionDefaultTest} pins down.</p>
 */
@QuarkusTest
@TestProfile(MinimumAppVersionTest.Raised.class)
class MinimumAppVersionTest {

    @Test
    void shouldAnnounceTheOldestAppItServes() {
        given()
            .when().get("/api/version")
            .then()
            .statusCode(200)
            .body("minimumAppVersion", equalTo("9.0.0"));
    }

    /** A deployment that has dropped what apps before 9.0.0 needed. */
    public static class Raised implements QuarkusTestProfile {

        @Override
        public Map<String, String> getConfigOverrides() {
            return Map.of("taskfest.minimum-app-version", "9.0.0");
        }
    }
}
