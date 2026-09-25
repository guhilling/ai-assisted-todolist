package io.github.guhilling.todo.api;

import io.github.guhilling.todo.model.Task;
import io.github.guhilling.todo.model.TaskImportance;
import io.github.guhilling.todo.model.TaskState;
import io.github.guhilling.todo.model.User;
import io.github.guhilling.todo.service.UserService;
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
import org.eclipse.microprofile.jwt.JsonWebToken;

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
public class TaskResource {

    @Inject
    JsonWebToken jwt;

    @Inject
    UserService userService;

    @GET
    public List<TaskResponse> list() {
        User owner = currentUser();
        return Task.<Task>find("owner = ?1 order by dueDate asc, id asc", owner).stream()
            .map(TaskResource::toResponse)
            .toList();
    }

    @POST
    @Transactional
    public Response create(@Valid TaskRequest request) {
        Task task = new Task();
        task.owner = currentUser();
        apply(task, request);
        task.persist();
        return Response.status(Response.Status.CREATED)
            .entity(toResponse(task))
            .build();
    }

    @PUT
    @Path("/{id}")
    @Transactional
    public TaskResponse update(@PathParam("id") Long id, @Valid TaskRequest request) {
        Task task = findOwnedTaskOrNotFound(id);
        apply(task, request);
        return toResponse(task);
    }

    @DELETE
    @Path("/{id}")
    @Transactional
    public Response delete(@PathParam("id") Long id) {
        Task task = findOwnedTaskOrNotFound(id);
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
        return userService.getOrCreateByEmail(jwt.getClaim("email"));
    }

    private static void apply(Task task, TaskRequest request) {
        task.description = request.description();
        task.dueDate = request.dueDate();
        task.importance = request.importance();
        task.state = request.state();
    }

    private static TaskResponse toResponse(Task task) {
        return new TaskResponse(task.id, task.description, task.dueDate, task.importance, task.state);
    }

    /**
     * What a client may set on a task, and the only shape this resource accepts.
     *
     * <p>It exists so the {@link Task} entity never reaches the wire: there is no id and no
     * owner here, so neither can be spoofed by a request body. The constraints mirror the
     * entity's own, which means a bad payload is rejected with a 400 before anything
     * touches the database.</p>
     *
     * @param description what is to be done, never blank
     * @param dueDate when it is due, today or later
     * @param importance how much it matters
     * @param state where it stands in the workflow
     */
    public record TaskRequest(
        @NotBlank @Size(max = Task.MAX_DESCRIPTION_LENGTH) String description,
        @NotNull @FutureOrPresent LocalDate dueDate,
        @NotNull TaskImportance importance,
        @NotNull TaskState state
    ) {
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
     * @param state where it stands in the workflow
     */
    public record TaskResponse(
        Long id,
        String description,
        LocalDate dueDate,
        TaskImportance importance,
        TaskState state
    ) {
    }
}
