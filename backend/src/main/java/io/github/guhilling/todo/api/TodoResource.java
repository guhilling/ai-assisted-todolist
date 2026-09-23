package io.github.guhilling.todo.api;

import io.github.guhilling.todo.model.TodoItem;
import io.github.guhilling.todo.model.TodoState;
import jakarta.transaction.Transactional;
import jakarta.validation.Valid;
import jakarta.validation.constraints.FutureOrPresent;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
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

@Path("/api/todos")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class TodoResource {

    @GET
    public List<TodoResponse> list() {
        return TodoItem.<TodoItem>list("order by dueDate asc, id asc").stream()
            .map(TodoResource::toResponse)
            .toList();
    }

    @POST
    @Transactional
    public Response create(@Valid TodoRequest request) {
        TodoItem item = new TodoItem();
        apply(item, request);
        item.persist();
        return Response.status(Response.Status.CREATED)
            .entity(toResponse(item))
            .build();
    }

    @PUT
    @Path("/{id}")
    @Transactional
    public TodoResponse update(@PathParam("id") Long id, @Valid TodoRequest request) {
        TodoItem item = TodoItem.findById(id);
        if (item == null) {
            throw new WebApplicationException(Response.Status.NOT_FOUND);
        }
        apply(item, request);
        return toResponse(item);
    }

    @DELETE
    @Path("/{id}")
    @Transactional
    public Response delete(@PathParam("id") Long id) {
        TodoItem item = TodoItem.findById(id);
        if (item == null) {
            throw new WebApplicationException(Response.Status.NOT_FOUND);
        }
        item.delete();
        return Response.noContent().build();
    }

    private static void apply(TodoItem item, TodoRequest request) {
        item.description = request.description();
        item.dueDate = request.dueDate();
        item.state = request.state();
    }

    private static TodoResponse toResponse(TodoItem item) {
        return new TodoResponse(item.id, item.description, item.dueDate, item.state);
    }

    public record TodoRequest(
        @NotBlank String description,
        @NotNull @FutureOrPresent LocalDate dueDate,
        @NotNull TodoState state
    ) {
    }

    public record TodoResponse(Long id, String description, LocalDate dueDate, TodoState state) {
    }
}
