package de.hilling.taskfest.api;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.media.Content;
import org.eclipse.microprofile.openapi.annotations.media.ExampleObject;
import org.eclipse.microprofile.openapi.annotations.media.Schema;
import org.eclipse.microprofile.openapi.annotations.responses.APIResponse;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/**
 * Says which release this backend is, to anyone who asks.
 *
 * <p>The prod approval reads it (#215): before anyone approves a deploy, a job without AWS
 * credentials compares the release's database changelog with the version actually running, so
 * the approval can say whether it means downtime. The version is the build's own -- the release
 * tag's, which {@code -Drevision} sets, or {@code 1.0.0-SNAPSHOT} for anything built from
 * {@code main} -- and naming it publicly gives away no more than the release page already does.</p>
 */
@Path("/api/version")
@Produces(MediaType.APPLICATION_JSON)
@Tag(name = "Deployment", description = "What a deployment runs, for the tooling that deploys it.")
public class VersionResource {

    /** Longer than any version this build would carry; a bound the schema can publish. */
    private static final int MAX_VERSION_LENGTH = 64;

    private final String version;

    /** The resource for the version this build was made as. */
    public VersionResource(@ConfigProperty(name = "quarkus.application.version") String version) {
        this.version = version;
    }

    @GET
    @Operation(summary = "Report the running release", description = "The version this backend was "
        + "built as, needing no authentication to ask.")
    @APIResponse(responseCode = "200", description = "The running version.",
        content = @Content(mediaType = MediaType.APPLICATION_JSON,
            schema = @Schema(implementation = VersionResponse.class),
            examples = @ExampleObject(name = "release", value = """
            {
              "version": "0.11.0"
            }""")))
    public VersionResponse version() {
        return new VersionResponse(version);
    }

    /**
     * The payload behind {@code GET /api/version}.
     *
     * @param version the release without its {@code v}, such as {@code 0.11.0}, or a SNAPSHOT
     */
    public record VersionResponse(
        @NotNull @Size(max = MAX_VERSION_LENGTH) @Schema(example = "0.11.0") String version
    ) {
    }
}
