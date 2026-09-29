package io.github.guhilling.todo.api;

import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.startsWith;

/**
 * Checks that the generated OpenAPI document is strict enough to generate a validator from.
 *
 * <p>The frontend compiles the {@code components.schemas} of this document into runtime
 * validators for every response it parses, so the document is not only documentation: a
 * property the spec fails to mark required is a property the frontend will accept as absent.
 * Nothing else in the build would notice that, because the annotations carry no runtime
 * behaviour on this side of the wire.</p>
 *
 * <p>The version assertion matters as much as the rest. Only from OpenAPI 3.1 onwards are
 * the component schemas JSON Schema documents; a downgrade to 3.0 would silently change
 * {@code nullable} handling and break the generated schemas.</p>
 */
@QuarkusTest
class OpenApiContractTest {

    /** Fetches the document as JSON, since the endpoint serves YAML unless asked otherwise. */
    private static io.restassured.response.ValidatableResponse spec() {
        return given()
            .queryParam("format", "json")
            .when().get("/q/openapi")
            .then()
            .statusCode(200);
    }

    @Test
    void shouldGenerateJsonSchemaCompatibleOpenApi() {
        spec().body("openapi", startsWith("3.1"));
    }

    @Test
    void shouldRequireEveryFieldOfATask() {
        spec().body(
            "components.schemas.TaskResponse.required",
            containsInAnyOrder("id", "description", "dueDate", "importance", "state"));
    }

    @Test
    void shouldRequireTheIdentifyingFieldOfTheCurrentUser() {
        spec().body("components.schemas.CurrentUserResponse.required", containsInAnyOrder("email"));
    }

    @Test
    void shouldAllowTheCurrentUsersOptionalFieldsToBeNull() {
        // A provider need not supply either, and the backend sends them as null rather than
        // omitting them, so a validator that rejected null would reject a legitimate response.
        spec()
            .body("components.schemas.CurrentUserResponse.properties.name.type", hasItem("null"))
            .body("components.schemas.CurrentUserResponse.properties.pictureUrl.type", hasItem("null"));
    }

    @Test
    void shouldRequireEveryFieldOfAnAuthProvider() {
        spec()
            .body(
                "components.schemas.AuthProviderResponse.required",
                containsInAnyOrder("id", "label", "available", "loginUrl", "issuer"))
            // Required but nullable: an unconfigured provider has no login URL, and the board
            // relies on being told so rather than on the field going missing.
            .body("components.schemas.AuthProviderResponse.properties.loginUrl.type", hasItem("null"));
    }

    @Test
    void shouldRequireEveryFieldOfTheProvidersResponse() {
        spec().body(
            "components.schemas.AuthProvidersResponse.required",
            containsInAnyOrder("enabled", "providers"));
    }
}
