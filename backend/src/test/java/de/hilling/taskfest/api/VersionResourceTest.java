package de.hilling.taskfest.api;

import io.quarkus.test.junit.QuarkusTest;
import org.eclipse.microprofile.config.ConfigProvider;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;

/**
 * Pins down that anyone can ask which release a deployment runs (#215), which the prod approval
 * reads before anyone has signed in.
 *
 * <p>The expected value is read from configuration rather than written down, because the same test
 * runs on {@code main} as {@code 1.0.0-SNAPSHOT} and in the release gate as the tag's version.</p>
 */
@QuarkusTest
class VersionResourceTest {

    @Test
    void shouldReportTheBuildsVersionWithoutSignIn() {
        String built = ConfigProvider.getConfig().getValue("quarkus.application.version", String.class);

        given()
            .when().get("/api/version")
            .then()
            .statusCode(200)
            .body("version", equalTo(built));
    }
}
