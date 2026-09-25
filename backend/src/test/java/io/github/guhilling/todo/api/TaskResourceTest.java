package io.github.guhilling.todo.api;

import io.github.guhilling.todo.model.Task;
import io.github.guhilling.todo.model.TaskImportance;
import io.github.guhilling.todo.model.TaskState;
import io.github.guhilling.todo.model.User;
import io.quarkus.narayana.jta.QuarkusTransaction;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.security.TestSecurity;
import io.quarkus.test.security.oidc.Claim;
import io.quarkus.test.security.oidc.OidcSecurity;
import io.restassured.http.ContentType;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

import static io.restassured.RestAssured.given;
import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;

/**
 * Covers the task board's REST contract with identity faked by {@code @TestSecurity}.
 *
 * <p>Injecting the email claim directly keeps these tests fast and lets them assert the
 * ownership rules from several identities without a login round trip. The price is that
 * they prove nothing about the sign-in flow itself -- that is
 * {@link KeycloakLoginFlowTest}'s job, which drives the same endpoints through a real
 * authorization code exchange.</p>
 */
@QuarkusTest
class TaskResourceTest {

    private static final String ALICE = "alice@example.com";

    @Test
    void shouldRejectAnonymousRequests() {
        given()
            .header("X-Requested-With", "JavaScript")
            .when().get("/api/tasks")
            .then()
            .statusCode(not(200));
    }

    @Test
    @TestSecurity(user = ALICE)
    @OidcSecurity(claims = { @Claim(key = "email", value = ALICE) })
    void shouldCreateTaskOwnedByCurrentUser() {
        String description = "Write the report " + UUID.randomUUID();

        given()
            .contentType(ContentType.JSON)
            .body(Map.of(
                "description", description,
                "dueDate", LocalDate.now().plusDays(3).toString(),
                "importance", "HIGH",
                "state", "TODO"))
            .when().post("/api/tasks")
            .then()
            .statusCode(201)
            .body("description", equalTo(description));

        given()
            .when().get("/api/tasks")
            .then()
            .statusCode(200)
            .body("find { it.description == '" + description + "' }.importance", equalTo("HIGH"));
    }

    @Test
    @TestSecurity(user = ALICE)
    @OidcSecurity(claims = { @Claim(key = "email", value = ALICE) })
    void shouldNotListOtherUsersTasks() {
        String aliceDescription = "Alice only task " + UUID.randomUUID();
        String othersDescription = "Other user's task " + UUID.randomUUID();
        seedTaskForOtherUser(othersDescription);

        given()
            .contentType(ContentType.JSON)
            .body(Map.of(
                "description", aliceDescription,
                "dueDate", LocalDate.now().plusDays(2).toString(),
                "importance", "MEDIUM",
                "state", "TODO"))
            .when().post("/api/tasks")
            .then()
            .statusCode(201);

        given()
            .when().get("/api/tasks")
            .then()
            .statusCode(200)
            .body("description", hasItem(aliceDescription))
            .body("description", not(hasItem(othersDescription)));
    }

    @Test
    @TestSecurity(user = ALICE)
    @OidcSecurity(claims = { @Claim(key = "email", value = ALICE) })
    void shouldReturn404UpdatingAnotherUsersTask() {
        Long otherUsersTaskId = seedTaskForOtherUser("Someone else's task " + UUID.randomUUID());

        given()
            .contentType(ContentType.JSON)
            .body(Map.of(
                "description", "attempted takeover",
                "dueDate", LocalDate.now().plusDays(1).toString(),
                "importance", "LOW",
                "state", "DONE"))
            .when().put("/api/tasks/{id}", otherUsersTaskId)
            .then()
            .statusCode(404);
    }

    @Test
    @TestSecurity(user = ALICE)
    @OidcSecurity(claims = { @Claim(key = "email", value = ALICE) })
    void shouldDeleteOwnTask() {
        Long taskId = createTask("Delete me " + UUID.randomUUID(), LocalDate.now().plusDays(4), "LOW", "TODO");

        given()
            .when().delete("/api/tasks/{id}", taskId)
            .then()
            .statusCode(204);

        given()
            .when().get("/api/tasks")
            .then()
            .statusCode(200)
            .body("id", not(hasItem(taskId.intValue())));
    }

    @Test
    @TestSecurity(user = ALICE)
    @OidcSecurity(claims = { @Claim(key = "email", value = ALICE) })
    void shouldReturn404DeletingAnotherUsersTaskAndLeaveItWhereItWas() {
        Long otherUsersTaskId = seedTaskForOtherUser("Someone else's task " + UUID.randomUUID());

        given()
            .when().delete("/api/tasks/{id}", otherUsersTaskId)
            .then()
            .statusCode(404);

        // The status alone would also be produced by a route that does not exist. Checking the
        // row survived is what makes this a test of ownership rather than of routing.
        assertThat(taskCount(otherUsersTaskId), equalTo(1L));
    }

    @Test
    @TestSecurity(user = ALICE)
    @OidcSecurity(claims = { @Claim(key = "email", value = ALICE) })
    void shouldUpdateOwnTask() {
        Long taskId = createTask("Before " + UUID.randomUUID(), LocalDate.now().plusDays(4), "LOW", "TODO");
        String updatedDescription = "After " + UUID.randomUUID();

        given()
            .contentType(ContentType.JSON)
            .body(Map.of(
                "description", updatedDescription,
                "dueDate", LocalDate.now().plusDays(6).toString(),
                "importance", "HIGH",
                "state", "DONE"))
            .when().put("/api/tasks/{id}", taskId)
            .then()
            .statusCode(200)
            .body("id", equalTo(taskId.intValue()))
            .body("description", equalTo(updatedDescription))
            .body("importance", equalTo("HIGH"))
            .body("state", equalTo("DONE"));

        given()
            .when().get("/api/tasks")
            .then()
            .statusCode(200)
            .body("find { it.id == " + taskId + " }.state", equalTo("DONE"));
    }

    @ParameterizedTest(name = "rejects {0}")
    @MethodSource("invalidTaskRequests")
    @TestSecurity(user = ALICE)
    @OidcSecurity(claims = { @Claim(key = "email", value = ALICE) })
    void shouldRejectAnInvalidTaskRequest(String reason, String body) {
        given()
            .contentType(ContentType.JSON)
            .body(body)
            .when().post("/api/tasks")
            .then()
            .statusCode(400);
    }

    static Stream<Arguments> invalidTaskRequests() {
        String tomorrow = LocalDate.now().plusDays(1).toString();
        return Stream.of(
            Arguments.of("a blank description", taskJson("", tomorrow, "\"MEDIUM\"", "\"TODO\"")),
            Arguments.of("a description past the column length",
                taskJson("x".repeat(Task.MAX_DESCRIPTION_LENGTH + 1), tomorrow, "\"MEDIUM\"", "\"TODO\"")),
            Arguments.of("a due date in the past",
                taskJson("Yesterday's job", LocalDate.now().minusDays(1).toString(), "\"MEDIUM\"", "\"TODO\"")),
            Arguments.of("no importance", taskJson("Unrated job", tomorrow, "null", "\"TODO\"")),
            Arguments.of("no state", taskJson("Stateless job", tomorrow, "\"MEDIUM\"", "null")));
    }

    @Test
    @TestSecurity(user = ALICE)
    @OidcSecurity(claims = { @Claim(key = "email", value = ALICE) })
    void shouldNotPersistARejectedTask() {
        String description = "Rejected " + UUID.randomUUID();
        int tasksBefore = ownTaskCount();

        given()
            .contentType(ContentType.JSON)
            .body(taskJson(description, LocalDate.now().minusDays(1).toString(), "\"HIGH\"", "\"TODO\""))
            .when().post("/api/tasks")
            .then()
            .statusCode(400);

        given()
            .when().get("/api/tasks")
            .then()
            .body("description", not(hasItem(description)));
        assertThat(ownTaskCount(), equalTo(tasksBefore));
    }

    @Test
    @TestSecurity(user = ALICE)
    @OidcSecurity(claims = { @Claim(key = "email", value = ALICE) })
    void shouldListTasksInDueDateOrder() {
        String marker = "ordering-" + UUID.randomUUID();
        createTask(marker + " third", LocalDate.now().plusDays(9), "LOW", "TODO");
        createTask(marker + " first", LocalDate.now().plusDays(3), "LOW", "TODO");
        createTask(marker + " second", LocalDate.now().plusDays(6), "LOW", "TODO");

        List<String> ordered = given()
            .when().get("/api/tasks")
            .then()
            .statusCode(200)
            .extract().jsonPath().getList("description", String.class)
            .stream()
            .filter(description -> description.startsWith(marker))
            .toList();

        assertThat(ordered, equalTo(List.of(marker + " first", marker + " second", marker + " third")));
    }

    @Test
    void shouldRejectAnonymousWrites() {
        given()
            .header("X-Requested-With", "JavaScript")
            .contentType(ContentType.JSON)
            .body(taskJson("Anonymous job", LocalDate.now().plusDays(1).toString(), "\"HIGH\"", "\"TODO\""))
            .when().post("/api/tasks")
            .then()
            .statusCode(not(201));

        given()
            .header("X-Requested-With", "JavaScript")
            .when().delete("/api/tasks/{id}", 1)
            .then()
            .statusCode(not(204));
    }

    private static Long createTask(String description, LocalDate dueDate, String importance, String state) {
        return given()
            .contentType(ContentType.JSON)
            .body(Map.of(
                "description", description,
                "dueDate", dueDate.toString(),
                "importance", importance,
                "state", state))
            .when().post("/api/tasks")
            .then()
            .statusCode(201)
            .extract().jsonPath().getLong("id");
    }

    /**
     * Builds a request body as text rather than as a map, so a null enum can be sent -- which
     * is one of the shapes the validation constraints exist to reject.
     */
    private static String taskJson(String description, String dueDate, String importance, String state) {
        return """
            {"description":"%s","dueDate":"%s","importance":%s,"state":%s}"""
            .formatted(description, dueDate, importance, state);
    }

    private static int ownTaskCount() {
        return given().when().get("/api/tasks").then().statusCode(200).extract().jsonPath().getList("$").size();
    }

    private static long taskCount(Long taskId) {
        return QuarkusTransaction.requiringNew().call(() -> Task.count("id", taskId));
    }

    private static Long seedTaskForOtherUser(String description) {
        return QuarkusTransaction.requiringNew().call(() -> {
            User owner = new User();
            owner.email = "owner-" + UUID.randomUUID() + "@example.com";
            owner.persist();

            Task task = new Task();
            task.description = description;
            task.dueDate = LocalDate.now().plusDays(5);
            task.importance = TaskImportance.MEDIUM;
            task.state = TaskState.TODO;
            task.owner = owner;
            task.persist();
            return task.id;
        });
    }
}
