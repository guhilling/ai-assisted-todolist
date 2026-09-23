package io.github.guhilling.todo.api;

import io.github.guhilling.todo.model.TodoState;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.http.ContentType;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.greaterThanOrEqualTo;

@QuarkusTest
class TodoResourceTest {

    @Test
    void shouldListSeededTodos() {
        given()
            .when().get("/api/todos")
            .then()
            .statusCode(200)
            .body("size()", greaterThanOrEqualTo(1))
            .body("find { it.description == 'Bootstrap the todo platform' }.state", equalTo(TodoState.PLANNED.name()));
    }

    @Test
    void shouldCreateAndUpdateTodo() {
        int id = given()
            .contentType(ContentType.JSON)
            .body(Map.of(
                "description", "Implement the frontend",
                "dueDate", LocalDate.now().plusDays(5).toString(),
                "state", TodoState.WORKING.name()))
            .when().post("/api/todos")
            .then()
            .statusCode(201)
            .body("description", equalTo("Implement the frontend"))
            .extract()
            .path("id");

        given()
            .contentType(ContentType.JSON)
            .body(Map.of(
                "description", "Implement the frontend",
                "dueDate", LocalDate.now().plusDays(7).toString(),
                "state", TodoState.DONE.name()))
            .when().put("/api/todos/{id}", id)
            .then()
            .statusCode(200)
            .body("state", equalTo(TodoState.DONE.name()));

        given()
            .when().get("/api/todos")
            .then()
            .statusCode(200)
            .body("find { it.id == " + id + " }.state", equalTo(TodoState.DONE.name()));
    }

    @Test
    void shouldExposeOidcProviderPlaceholders() {
        given()
            .when().get("/api/auth/providers")
            .then()
            .statusCode(200)
            .body("enabled", equalTo(false))
            .body("providers.size()", equalTo(4))
            .body("providers.find { it.id == 'google' }.label", equalTo("Google"));
    }
}
