package de.hilling.taskfest.api;

import de.hilling.taskfest.model.Task;
import de.hilling.taskfest.model.TaskImportance;
import de.hilling.taskfest.model.TaskState;
import de.hilling.taskfest.model.User;
import io.quarkus.narayana.jta.QuarkusTransaction;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.security.TestSecurity;
import io.quarkus.test.security.oidc.Claim;
import io.quarkus.test.security.oidc.OidcSecurity;
import io.restassured.http.ContentType;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;
import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Draft tasks (#381) without files: out of sight until added, added only with what a create takes,
 * and reached only as drafts. With identity faked by {@code @TestSecurity}, against the real
 * database; {@link DraftTaskTest} has the files, against S3 in LocalStack.
 */
@QuarkusTest
class DraftResourceTest {

    @Test
    @TestSecurity(user = "draft-hidden@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "draft-hidden@example.com") })
    void shouldKeepADraftOffTheBoardAndOutOfReachAsATask() {
        long draftId = createDraft();

        given().when().get("/api/tasks").then().statusCode(200).body("id", not(hasItem((int) draftId)));
        given().contentType(ContentType.JSON).body(fields("Not yet a task"))
            .when().put("/api/tasks/" + draftId).then().statusCode(404);
        given().when().delete("/api/tasks/" + draftId).then().statusCode(404);
    }

    @Test
    @TestSecurity(user = "draft-invalid@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "draft-invalid@example.com") })
    void shouldAddADraftOnlyWithWhatACreateTakes() {
        long draftId = createDraft();

        given().contentType(ContentType.JSON)
            .body(Map.of("description", " ", "dueDate", LocalDate.now().plusDays(1).toString(),
                "importance", TaskImportance.MEDIUM.name(), "state", TaskState.TODO.name()))
            .when().post("/api/tasks/drafts/" + draftId + "/add").then().statusCode(400);
        given().contentType(ContentType.JSON)
            .body(Map.of("description", "Yesterday", "dueDate", LocalDate.now(ZoneOffset.UTC).minusDays(2).toString(),
                "importance", TaskImportance.MEDIUM.name(), "state", TaskState.TODO.name()))
            .when().post("/api/tasks/drafts/" + draftId + "/add").then().statusCode(400);

        given().when().get("/api/tasks").then().body("id", not(hasItem((int) draftId)));
    }

    @Test
    @TestSecurity(user = "draft-added-twice@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "draft-added-twice@example.com") })
    void shouldAddADraftAgainAsTheTaskItBecameWithTheNewValues() {
        long draftId = createDraft();
        given().contentType(ContentType.JSON).body(fields("Its answer was lost"))
            .when().post("/api/tasks/drafts/" + draftId + "/add").then().statusCode(201);

        given().contentType(ContentType.JSON).body(fields("Typo fixed"))
            .when().post("/api/tasks/drafts/" + draftId + "/add").then().statusCode(201)
            .body("id", equalTo((int) draftId)).body("description", equalTo("Typo fixed"));

        given().when().get("/api/tasks").then()
            .body("findAll { it.id == " + draftId + " }.description", contains("Typo fixed"));
    }

    @Test
    @TestSecurity(user = "draft-not-mine@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "draft-not-mine@example.com") })
    void shouldDiscardOnlyADraftButAddATaskAgain() {
        long taskId = given().contentType(ContentType.JSON).body(fields("Already a task"))
            .when().post("/api/tasks").then().statusCode(201).extract().jsonPath().getLong("id");

        // Adding a task again is what a retry does when the first answer was lost (#427).
        given().contentType(ContentType.JSON).body(fields("Again"))
            .when().post("/api/tasks/drafts/" + taskId + "/add").then().statusCode(201)
            .body("description", equalTo("Again"));
        given().when().delete("/api/tasks/drafts/" + taskId).then().statusCode(404);
        given().when().delete("/api/tasks/drafts/" + Long.MAX_VALUE).then().statusCode(404);
    }

    @Test
    @TestSecurity(user = "draft-takeover@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "draft-takeover@example.com") })
    void shouldAnswerSomeoneElsesTaskLikeAMissingDraft() {
        Long othersTaskId = QuarkusTransaction.requiringNew().call(() -> {
            User owner = new User();
            owner.email = "draft-owner-" + UUID.randomUUID() + "@example.com";
            owner.persist();
            Task task = new Task();
            task.description = "Someone else's";
            task.dueDate = LocalDate.now().plusDays(5);
            task.importance = TaskImportance.MEDIUM;
            task.state = TaskState.TODO;
            task.owner = owner;
            task.persist();
            return task.id;
        });

        given().contentType(ContentType.JSON).body(fields("Attempted takeover"))
            .when().post("/api/tasks/drafts/" + othersTaskId + "/add").then().statusCode(404);

        assertEquals("Someone else's",
            QuarkusTransaction.requiringNew().call(() -> Task.<Task>findById(othersTaskId).description));
    }

    private static long createDraft() {
        return given().when().post("/api/tasks/drafts").then().statusCode(201).extract().jsonPath().getLong("id");
    }

    private static Map<String, String> fields(String description) {
        return Map.of("description", description, "dueDate", LocalDate.now().plusDays(1).toString(),
            "importance", TaskImportance.MEDIUM.name(), "state", TaskState.TODO.name());
    }
}
