package de.hilling.taskfest.api;

import de.hilling.taskfest.attachment.Attachment;
import de.hilling.taskfest.attachment.AttachmentService;
import de.hilling.taskfest.attachment.AttachmentState;
import de.hilling.taskfest.attachment.AttachmentStore;
import de.hilling.taskfest.model.Task;
import de.hilling.taskfest.model.User;
import de.hilling.taskfest.service.UserService;
import io.quarkus.oidc.IdToken;
import io.quarkus.security.Authenticated;
import jakarta.inject.Inject;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.WebApplicationException;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.time.Instant;
import java.util.Map;
import org.eclipse.microprofile.jwt.JsonWebToken;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.media.Content;
import org.eclipse.microprofile.openapi.annotations.media.Schema;
import org.eclipse.microprofile.openapi.annotations.responses.APIResponse;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/**
 * A task's attachments (#204). The browser moves the file content itself, straight to and from S3,
 * through links handed out here; this resource only ever sees metadata.
 *
 * <p>Uploading is three steps: announce the file (name, type, size) and get a link that accepts
 * exactly that file; PUT the file to the link; confirm. Opening a file is asking for a link that
 * works for a few minutes. Every attachment is its task's owner's alone: someone else's task or
 * attachment is answered like a missing one.</p>
 */
@Path("/api/tasks/{taskId}/attachments")
@Authenticated
@Produces(MediaType.APPLICATION_JSON)
@Tag(name = "Attachments", description = "Files on a task, transferred directly between the browser and storage.")
public class AttachmentResource {

    /** The longest URL handed out; presigned S3 URLs run to a little over a thousand characters. */
    private static final int MAX_URL_LENGTH = 4096;

    /** The longest media type a client may announce. */
    private static final int MAX_CONTENT_TYPE_LENGTH = 255;

    /** The status a refused attachment is answered with: the request was understood, and declined. */
    private static final int UNPROCESSABLE = 422;

    /** The status an unconfirmable upload is answered with: it has not arrived yet. */
    private static final int CONFLICT = 409;

    /** The ID token, for the same reason as in {@code TaskResource}: Google's access token is opaque. */
    @Inject
    @IdToken
    JsonWebToken jwt;

    @Inject
    UserService userService;

    @Inject
    AttachmentService attachments;

    @POST
    @Consumes(MediaType.APPLICATION_JSON)
    @Operation(summary = "Announce an upload", description = "Checks the type and the limits, and answers "
        + "with a link that accepts exactly this file: PUT it there with the given headers, then confirm.")
    @APIResponse(responseCode = "201", description = "The attachment, pending, and its upload link.",
        content = @Content(mediaType = MediaType.APPLICATION_JSON,
            schema = @Schema(implementation = UploadResponse.class)))
    @APIResponse(responseCode = "422", description = "Refused: an unsupported type, too large, or a limit reached.",
        content = @Content(mediaType = MediaType.APPLICATION_JSON,
            schema = @Schema(implementation = RefusalResponse.class)))
    @APIResponse(responseCode = "404", description = "No task with this id is owned by the caller.")
    public Response announce(@PathParam("taskId") Long taskId, @Valid AnnounceRequest request) {
        User owner = currentUser();
        Task task = ownedTask(taskId, owner);
        try {
            AttachmentService.Announced announced =
                attachments.announce(owner, task, request.fileName(), request.contentType(), request.sizeBytes());
            AttachmentStore.UploadLink upload = announced.upload();
            return Response.status(Response.Status.CREATED)
                .entity(new UploadResponse(toResponse(announced.attachment()), upload.url(), upload.headers(),
                    upload.expiresAt()))
                .build();
        } catch (AttachmentService.Refused refused) {
            throw refusal(refused);
        }
    }

    @POST
    @Path("/{id}/confirm")
    @Operation(summary = "Confirm an upload", description = "Checks the file arrived as announced and makes "
        + "the attachment available.")
    @APIResponse(responseCode = "200", description = "The attachment, available.",
        content = @Content(mediaType = MediaType.APPLICATION_JSON,
            schema = @Schema(implementation = AttachmentResponse.class)))
    @APIResponse(responseCode = "409", description = "The file has not arrived yet.")
    @APIResponse(responseCode = "422", description = "What arrived is not what was announced; it was deleted.",
        content = @Content(mediaType = MediaType.APPLICATION_JSON,
            schema = @Schema(implementation = RefusalResponse.class)))
    @APIResponse(responseCode = "404", description = "No such attachment on a task the caller owns.")
    public AttachmentResponse confirm(@PathParam("taskId") Long taskId, @PathParam("id") Long id) {
        Attachment attachment = ownedAttachment(taskId, id);
        try {
            return attachments.confirm(attachment)
                .map(AttachmentResource::toResponse)
                .orElseThrow(() -> new WebApplicationException(CONFLICT));
        } catch (AttachmentService.Refused refused) {
            throw refusal(refused);
        }
    }

    @GET
    @Path("/{id}/link")
    @Operation(summary = "A link to open the file", description = "Works for a few minutes, for the owner's "
        + "browser to fetch the file straight from storage.")
    @APIResponse(responseCode = "200", description = "The link and until when it works.",
        content = @Content(mediaType = MediaType.APPLICATION_JSON,
            schema = @Schema(implementation = LinkResponse.class)))
    @APIResponse(responseCode = "404", description = "No such available attachment on a task the caller owns.")
    public LinkResponse link(@PathParam("taskId") Long taskId, @PathParam("id") Long id) {
        Attachment attachment = ownedAttachment(taskId, id);
        if (attachment.state != AttachmentState.AVAILABLE) {
            throw new WebApplicationException(Response.Status.NOT_FOUND);
        }
        AttachmentStore.DownloadLink link = attachments.link(attachment);
        return new LinkResponse(link.url(), link.expiresAt());
    }

    @DELETE
    @Path("/{id}")
    @Operation(summary = "Remove an attachment", description = "Deletes the file and its record.")
    @APIResponse(responseCode = "204", description = "Removed.")
    @APIResponse(responseCode = "404", description = "No such attachment on a task the caller owns.")
    public Response remove(@PathParam("taskId") Long taskId, @PathParam("id") Long id) {
        attachments.remove(ownedAttachment(taskId, id));
        return Response.noContent().build();
    }

    private Attachment ownedAttachment(Long taskId, Long id) {
        User owner = currentUser();
        return attachments.find(owner, ownedTask(taskId, owner), id)
            .orElseThrow(() -> new WebApplicationException(Response.Status.NOT_FOUND));
    }

    private static Task ownedTask(Long taskId, User owner) {
        Task task = Task.<Task>find("id = ?1 and owner = ?2", taskId, owner).firstResult();
        if (task == null) {
            throw new WebApplicationException(Response.Status.NOT_FOUND);
        }
        return task;
    }

    private User currentUser() {
        return userService.getOrCreateByEmail(jwt.getClaim(OidcClaims.EMAIL));
    }

    private static WebApplicationException refusal(AttachmentService.Refused refused) {
        return new WebApplicationException(Response.status(UNPROCESSABLE)
            .type(MediaType.APPLICATION_JSON)
            .entity(new RefusalResponse(refused.reason()))
            .build());
    }

    static AttachmentResponse toResponse(Attachment attachment) {
        return new AttachmentResponse(attachment.id, attachment.fileName, attachment.kind.contentType(),
            attachment.sizeBytes);
    }

    /**
     * What the browser announces before uploading: the file's name, type and size, which the upload
     * link is then signed for.
     *
     * @param fileName the file's name; cleaned of any path, line break or quote
     * @param contentType its media type: a PDF or an image (D2 on #204)
     * @param sizeBytes its size, at most the configured limit (D1)
     */
    public record AnnounceRequest(
        @NotBlank @Size(max = Attachment.MAX_FILE_NAME_LENGTH) @Schema(example = "Rechnung.pdf") String fileName,
        @NotBlank @Size(max = MAX_CONTENT_TYPE_LENGTH) @Schema(example = "application/pdf") String contentType,
        @NotNull @Min(1) @Schema(example = "48213") Long sizeBytes
    ) {
    }

    /**
     * One attachment as the board lists it.
     *
     * @param id its id
     * @param fileName the name it is listed and opened under
     * @param contentType its media type
     * @param sizeBytes its size in bytes
     */
    public record AttachmentResponse(
        @NotNull @Schema(example = "7") Long id,
        @NotNull @Size(max = Attachment.MAX_FILE_NAME_LENGTH) @Schema(example = "Rechnung.pdf") String fileName,
        @NotNull @Size(max = MAX_CONTENT_TYPE_LENGTH) @Schema(example = "application/pdf") String contentType,
        @NotNull @Schema(example = "48213") Long sizeBytes
    ) {
    }

    /**
     * An announced attachment and how to upload it.
     *
     * @param attachment the attachment, pending until confirmed
     * @param url where to PUT the file
     * @param headers the headers the PUT must carry, exactly; the browser adds Content-Length itself
     * @param expiresAt until when the link works
     */
    public record UploadResponse(
        @NotNull AttachmentResponse attachment,
        @NotNull @Size(max = MAX_URL_LENGTH) String url,
        @NotNull Map<String, String> headers,
        @NotNull Instant expiresAt
    ) {
    }

    /**
     * A link to open a file.
     *
     * @param url where the browser fetches the file
     * @param expiresAt until when the link works
     */
    public record LinkResponse(
        @NotNull @Size(max = MAX_URL_LENGTH) String url,
        @NotNull Instant expiresAt
    ) {
    }

    /**
     * Why an attachment was refused, for the board to say in the visitor's language.
     *
     * @param refusal {@code UNSUPPORTED_TYPE}, {@code EMPTY}, {@code TOO_LARGE}, {@code TASK_FULL},
     *     {@code USER_FULL} or {@code MISMATCH}
     */
    public record RefusalResponse(
        @NotNull @Schema(example = "TASK_FULL", enumeration = {"UNSUPPORTED_TYPE", "EMPTY", "TOO_LARGE", "TASK_FULL",
            "USER_FULL", "MISMATCH"}) String refusal
    ) {
    }
}
