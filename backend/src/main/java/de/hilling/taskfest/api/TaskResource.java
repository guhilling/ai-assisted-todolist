package de.hilling.taskfest.api;

import de.hilling.taskfest.attachment.Attachment;
import de.hilling.taskfest.attachment.AttachmentService;
import de.hilling.taskfest.model.Task;
import de.hilling.taskfest.model.TaskImportance;
import de.hilling.taskfest.model.TaskState;
import de.hilling.taskfest.model.User;
import de.hilling.taskfest.service.UserService;
import io.quarkus.security.Authenticated;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.validation.Valid;
import jakarta.validation.constraints.FutureOrPresent;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.WebApplicationException;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import io.quarkus.oidc.IdToken;
import org.eclipse.microprofile.jwt.JsonWebToken;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.enums.SchemaType;
import org.eclipse.microprofile.openapi.annotations.media.Content;
import org.eclipse.microprofile.openapi.annotations.media.ExampleObject;
import org.eclipse.microprofile.openapi.annotations.media.Schema;
import org.eclipse.microprofile.openapi.annotations.responses.APIResponse;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/**
 * The task board's REST surface: everything a signed-in user can do to their own tasks.
 *
 * <p>Ownership is enforced in every query rather than checked after loading, so a task
 * belonging to someone else is indistinguishable from one that does not exist — an
 * unauthorised update and a wrong id both come back as 404. The owner is derived from the
 * token's email claim on each request, never taken from the request body, which is what
 * keeps one account from writing into another's board.</p>
 */
@Path("/api/tasks")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@Authenticated
@Tag(name = "Tasks", description = "Everything a signed-in user can do to their own tasks.")
public class TaskResource {

    /** How many attachments an undo may bring back: a task carries at most a few (D1 on #204). */
    private static final int MAX_REATTACHED = 10;

    private static final String EXAMPLE_TASK = """
        {
          "id": 42,
          "description": "Renew the passport",
          "dueDate": "2026-11-30",
          "importance": "HIGH",
          "state": "TODO"
        }""";

    /**
     * The ID token, deliberately: a bare {@code JsonWebToken} is the access token, which Google
     * issues opaque, so reading claims from it failed every signed-in request in qa.
     * {@code ClaimsComeFromTheIdTokenTest} holds every class to this.
     */
    @Inject
    @IdToken
    JsonWebToken jwt;

    @Inject
    UserService userService;

    @Inject
    AttachmentService attachments;

    @GET
    @Operation(summary = "List the caller's tasks", description = "Ordered by due date, then id.")
    @APIResponse(responseCode = "200", description = "The caller's tasks.",
        content = @Content(mediaType = MediaType.APPLICATION_JSON,
            schema = @Schema(type = SchemaType.ARRAY, implementation = TaskResponse.class),
            examples = @ExampleObject(name = "tasks", value = "[" + EXAMPLE_TASK + "]")))
    public List<TaskResponse> list() {
        User owner = currentUser();
        List<Task> tasks = Task.<Task>find("owner = ?1 order by dueDate asc, id asc", owner).list();
        // One query for every task's attachments, so the count of statements stays constant.
        Map<Long, List<Attachment>> attached = attachments.availableOf(tasks);
        return tasks.stream()
            .map(task -> toResponse(task, attached.getOrDefault(task.id, List.of())))
            .toList();
    }

    @POST
    @Transactional
    @Operation(summary = "Create a task", description = "The caller becomes the owner; the id cannot be set.")
    @APIResponse(responseCode = "201", description = "The task as created.",
        content = @Content(mediaType = MediaType.APPLICATION_JSON,
            schema = @Schema(implementation = TaskResponse.class),
            examples = @ExampleObject(name = "task", value = EXAMPLE_TASK)))
    @APIResponse(responseCode = "400", description = "A field failed validation, for example a blank "
        + "description or a due date in the past.")
    public Response create(@Valid TaskCreateRequest request) {
        Task task = new Task();
        task.owner = currentUser();
        apply(task, request);
        task.persist();
        // An undo re-creating a deleted task brings its attachments back with it (D3 on #204).
        attachments.reattach(task.owner, task, request.attachmentIds());
        return Response.status(Response.Status.CREATED)
            .entity(toResponse(task))
            .build();
    }

    @PUT
    @Path("/{id}")
    @Transactional
    @Operation(summary = "Replace a task", description = "Replaces every field of a task owned by the caller.")
    @APIResponse(responseCode = "200", description = "The task as updated.",
        content = @Content(mediaType = MediaType.APPLICATION_JSON,
            schema = @Schema(implementation = TaskResponse.class),
            examples = @ExampleObject(name = "task", value = EXAMPLE_TASK)))
    @APIResponse(responseCode = "400", description = "A field failed validation.")
    @APIResponse(responseCode = "404", description = "No task with this id is owned by the caller.")
    public TaskResponse update(@PathParam("id") Long id, @Valid TaskUpdateRequest request) {
        Task task = findOwnedTaskOrNotFound(id);
        apply(task, request);
        return toResponse(task);
    }

    @DELETE
    @Path("/{id}")
    @Transactional
    @Operation(summary = "Delete a task")
    @APIResponse(responseCode = "204", description = "The task was deleted.")
    @APIResponse(responseCode = "404", description = "No task with this id is owned by the caller.")
    public Response delete(@PathParam("id") Long id) {
        Task task = findOwnedTaskOrNotFound(id);
        // Kept for the undo window, not deleted with the task (D3 on #204).
        attachments.detachAll(task);
        task.delete();
        return Response.noContent().build();
    }

    private Task findOwnedTaskOrNotFound(Long id) {
        User owner = currentUser();
        Task task = Task.<Task>find("id = ?1 and owner = ?2", id, owner).firstResult();
        if (task == null) {
            throw new WebApplicationException(Response.Status.NOT_FOUND);
        }
        return task;
    }

    private User currentUser() {
        return userService.getOrCreateByEmail(jwt.getClaim(OidcClaims.EMAIL));
    }

    private static void apply(Task task, TaskFields request) {
        task.description = request.description();
        task.dueDate = request.dueDate();
        task.importance = request.importance();
        task.state = request.state();
    }

    private TaskResponse toResponse(Task task) {
        return toResponse(task, attachments.availableOf(List.of(task)).getOrDefault(task.id, List.of()));
    }

    private static TaskResponse toResponse(Task task, List<Attachment> attached) {
        return new TaskResponse(task.id, task.description, task.dueDate, task.importance, task.state,
            attached.stream().map(AttachmentResource::toResponse).toList());
    }

    /**
     * The fields a client may set on a task, whichever direction the request came from.
     *
     * <p>It exists so {@link #apply} has one parameter type while create and update can carry
     * different constraints. Nothing outside this class implements it.</p>
     */
    public interface TaskFields {
        String description();
        LocalDate dueDate();
        TaskImportance importance();
        TaskState state();
    }

    /**
     * What a client may set when creating a task.
     *
     * <p>It exists so the {@link Task} entity never reaches the wire: there is no id and no
     * owner here, so neither can be spoofed by a request body. This is the one shape that
     * requires {@code dueDate} to be today or later — filing something new in the past is
     * almost always a mistyped year.</p>
     *
     * <p>The fields are declared again in {@link TaskUpdateRequest} rather than shared
     * through validation groups. {@code @Valid} validates only the {@code Default} group, so
     * a {@code @ConvertGroup} on this method would check the date and silently skip
     * {@code @NotBlank}, {@code @Size} and the {@code @NotNull}s. Two records cannot fail
     * that way, and the duplication is four lines.</p>
     *
     * @param description what is to be done, never blank
     * @param dueDate when it is due, today or later
     * @param importance how much it matters
     * @param state where it stands in the workflow
     * @param attachmentIds attachments of the task an undo re-creates, to attach again; usually absent
     */
    public record TaskCreateRequest(
        @NotBlank @Size(max = Task.MAX_DESCRIPTION_LENGTH) @Schema(example = "Renew the passport")
        String description,
        @NotNull @FutureOrPresent @Schema(example = "2026-11-30") LocalDate dueDate,
        @NotNull @Schema(example = "HIGH") TaskImportance importance,
        @NotNull @Schema(example = "TODO") TaskState state,
        @Size(max = MAX_REATTACHED) @Schema(description = "Attachments of a task deleted moments ago, for an undo "
            + "to bring back (#204); only the caller's, only within the undo window.", nullable = true)
        List<Long> attachmentIds
    ) implements TaskFields {
    }

    /**
     * What a client may set when changing an existing task.
     *
     * <p>Identical to {@link TaskCreateRequest} except that {@code dueDate} may be in the
     * past, which is the whole reason the two are separate. A task that came due yesterday
     * still has to be completable, and because this endpoint replaces the whole task, a
     * future-only rule here made every overdue task un-editable — including the state change
     * that marks it done.</p>
     *
     * @param description what is to be done, never blank
     * @param dueDate when it is due, past dates allowed
     * @param importance how much it matters
     * @param state where it stands in the workflow
     */
    public record TaskUpdateRequest(
        @NotBlank @Size(max = Task.MAX_DESCRIPTION_LENGTH) @Schema(example = "Renew the passport")
        String description,
        @NotNull @Schema(example = "2026-11-30") LocalDate dueDate,
        @NotNull @Schema(example = "HIGH") TaskImportance importance,
        @NotNull @Schema(example = "TODO") TaskState state
    ) implements TaskFields {
    }

    /**
     * A task as the frontend sees it, matching the {@code Task} type in {@code App.tsx}.
     *
     * <p>The audit timestamps and the owner are deliberately left out: the board has no use
     * for them, and the owner is always the caller anyway.</p>
     *
     * @param id the generated identifier, used to address the task on update and delete
     * @param description what is to be done
     * @param dueDate when it is due
     * @param importance how much it matters
     * <p>Every component carries {@code @NotNull}, which is what marks it required in the
     * generated schema. The frontend compiles that schema into a runtime validator, so a field
     * the spec leaves optional is a field it would accept as missing. None of them is ever
     * absent here, so the annotations only write down what this record already guarantees --
     * and being annotations rather than a list on the type, they cannot drift from the
     * components they describe.</p>
     *
     * @param state where it stands in the workflow
     * @param attachments its available attachments, oldest first
     */
    public record TaskResponse(
        @NotNull @Schema(example = "42") Long id,
        @NotNull @Size(max = Task.MAX_DESCRIPTION_LENGTH) @Schema(example = "Renew the passport")
        String description,
        @NotNull @Schema(example = "2026-11-30") LocalDate dueDate,
        @NotNull @Schema(example = "HIGH") TaskImportance importance,
        @NotNull @Schema(example = "TODO") TaskState state,
        @Schema(description = "Its available attachments (#204). Always sent; optional in the schema so the "
            + "board still validates a task from a backend rolled back to before attachments.")
        List<AttachmentResource.AttachmentResponse> attachments
    ) {
    }
}
