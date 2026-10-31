package de.hilling.taskfest.api;

import de.hilling.taskfest.attachment.AttachmentService;
import de.hilling.taskfest.model.Task;
import de.hilling.taskfest.model.TaskImportance;
import de.hilling.taskfest.model.User;
import io.quarkus.security.Authenticated;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.media.Content;
import org.eclipse.microprofile.openapi.annotations.media.Schema;
import org.eclipse.microprofile.openapi.annotations.responses.APIResponse;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/**
 * Draft tasks (#381): what the app's add form attaches files to before Add, so that they upload
 * while the form is filled in rather than after it.
 *
 * <p>A draft is a task with a draft marker, not a state of its own: the states are a task's
 * progress, and a draft has made none. It has no description or due date until it is added, and is
 * nowhere a task is seen -- not on the board, not to an update or a delete -- but takes files
 * through {@link AttachmentResource} as a task does, which count toward the owner's limit. Adding
 * it validates what a create does and makes it a task; adding it again updates that task, so a
 * retry whose first answer was lost adds nothing twice (#427). Discarding it removes its files at
 * once; one abandoned is swept with them by {@link de.hilling.taskfest.service.DraftSweep}.</p>
 */
@Path("/api/tasks/drafts")
@Produces(MediaType.APPLICATION_JSON)
@Authenticated
@Tag(name = "Tasks", description = "Everything a signed-in user can do to their own tasks.")
public class DraftResource {

    @Inject
    TaskResource tasks;

    @Inject
    AttachmentService attachments;

    @POST
    @Transactional
    @Operation(summary = "Start a draft task",
        description = "A task to attach files to before it is added; on no list until then (#381).")
    @APIResponse(responseCode = "201", description = "The draft.",
        content = @Content(mediaType = MediaType.APPLICATION_JSON,
            schema = @Schema(implementation = DraftResponse.class)))
    public Response create() {
        Task draft = new Task();
        draft.owner = tasks.currentUser();
        draft.draft = true;
        // Not null in the database for every task; Add sets what the form says.
        draft.importance = TaskImportance.MEDIUM;
        draft.persist();
        return Response.status(Response.Status.CREATED).entity(new DraftResponse(draft.id)).build();
    }

    @POST
    @Path("/{id}/add")
    @Consumes(MediaType.APPLICATION_JSON)
    @Transactional
    @Operation(summary = "Add a draft task",
        description = "Makes the draft a task, with its files, validated as a create is. Adding it"
            + " again, as a retry whose answer was lost does, applies the values to the task (#427).")
    @APIResponse(responseCode = "201", description = "The task as added.",
        content = @Content(mediaType = MediaType.APPLICATION_JSON,
            schema = @Schema(implementation = TaskResource.TaskResponse.class)))
    @APIResponse(responseCode = "400", description = "A field failed validation, as for a create.")
    @APIResponse(responseCode = "404", description = "No draft or task with this id is owned by the caller.")
    public Response add(@PathParam("id") Long id, @Valid TaskResource.TaskCreateRequest request) {
        Task draft = TaskResource.lockedTaskOrDraftOrNotFound(id, tasks.currentUser());
        TaskResource.apply(draft, request);
        draft.draft = false;
        return tasks.created(draft, request);
    }

    @DELETE
    @Path("/{id}")
    @Transactional
    @Operation(summary = "Discard a draft task", description = "Its files go with it, at once.")
    @APIResponse(responseCode = "204", description = "The draft was discarded.")
    @APIResponse(responseCode = "404", description = "No draft with this id is owned by the caller.")
    public Response discard(@PathParam("id") Long id) {
        User owner = tasks.currentUser();
        Task draft = TaskResource.ownedDraftOrNotFound(id, owner);
        attachments.removeAll(draft);
        draft.delete();
        return Response.noContent().build();
    }

    /**
     * A draft as the app sees it: only what it needs to attach files to it, and to add or discard it.
     *
     * @param id the draft's identifier, the task's once it is added
     */
    public record DraftResponse(@NotNull @Schema(example = "42") Long id) {
    }
}
