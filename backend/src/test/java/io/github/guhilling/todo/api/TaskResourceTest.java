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
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
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
