package de.hilling.taskfest.api;

import de.hilling.taskfest.attachment.Attachment;
import de.hilling.taskfest.attachment.AttachmentKind;
import de.hilling.taskfest.attachment.AttachmentService;
import de.hilling.taskfest.model.TaskImportance;
import de.hilling.taskfest.model.TaskState;
import de.hilling.taskfest.support.AttachmentStorageProfile;
import io.quarkus.narayana.jta.QuarkusTransaction;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.quarkus.test.security.TestSecurity;
import io.quarkus.test.security.oidc.Claim;
import io.quarkus.test.security.oidc.OidcSecurity;
import io.restassured.http.ContentType;
import io.restassured.response.ValidatableResponse;
import jakarta.inject.Inject;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * A link on a task (#414), end to end: added with its title, listed beside files with its URL,
 * opened by that URL rather than a storage link, counted against the limits, removed, and carried
 * through a deleted task's undo window -- all without an object in S3.
 *
 * <p>Identity is faked by {@code @TestSecurity}, each test as a user of its own because of the
 * per-user limit; S3 is LocalStack's, though a link never touches it.</p>
 */
@QuarkusTest
@TestProfile(AttachmentStorageProfile.class)
class LinkAttachmentTest {

    private static final String ARTICLE = "https://example.com/articles/42?ref=share";

    @Inject
    AttachmentService attachments;

    @Test
    @TestSecurity(user = "link@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "link@example.com") })
    void shouldAddAndListALinkWithItsTitleAndNoObject() {
        long taskId = createTask("Read later");

        long id = addLink(taskId, ARTICLE, "An article worth reading").statusCode(201)
            .body("fileName", equalTo("An article worth reading"))
            .body("contentType", equalTo(AttachmentKind.LINK.contentType()))
            .body("url", equalTo(ARTICLE))
            .body("thumbnail", equalTo(false))
            .extract().jsonPath().getLong("id");

        given().when().get("/api/tasks").then().statusCode(200)
            .body("find { it.id == " + taskId + " }.attachments.url", equalTo(List.of(ARTICLE)));
        assertNull(QuarkusTransaction.requiringNew().call(() -> Attachment.<Attachment>findById(id).objectKey));
    }

    @Test
    @TestSecurity(user = "untitled@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "untitled@example.com") })
    void shouldNameALinkWithoutATitleByItsUrl() {
        long taskId = createTask("Untitled");

        addLink(taskId, ARTICLE, null).statusCode(201).body("fileName", equalTo(ARTICLE));
    }

    @Test
    @TestSecurity(user = "multiline@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "multiline@example.com") })
    void shouldKeepATitleOnOneLine() {
        long taskId = createTask("A title over two lines");

        addLink(taskId, ARTICLE, "  Breaking:\nnews  ").statusCode(201).body("fileName", equalTo("Breaking: news"));
    }

    @Test
    @TestSecurity(user = "scheme@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "scheme@example.com") })
    void shouldRefuseAnythingButAWebAddress() {
        // A link is opened by whoever lists it: javascript: or data: would run in the board.
        long taskId = createTask("Only the web");

        for (String url : List.of("javascript:alert(1)", "data:text/html,hi", "ftp://example.com/x",
                "https://", "https://example.com/with space", "")) {
            addLink(taskId, url, "Nope").statusCode(400);
        }
        given().when().get("/api/tasks").then().body("find { it.id == " + taskId + " }.attachments", empty());
    }

    @Test
    @TestSecurity(user = "full-of-links@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "full-of-links@example.com") })
    void shouldCountLinksAgainstTheTasksLimit() {
        long taskId = createTask("Too many links");

        addLink(taskId, ARTICLE, "One").statusCode(201);
        addLink(taskId, ARTICLE, "Two").statusCode(201);
        addLink(taskId, ARTICLE, "Three").statusCode(422).body("refusal", equalTo("TASK_FULL"));
    }

    @Test
    @TestSecurity(user = "link-open@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "link-open@example.com") })
    void shouldHandOutNoStorageLinkForALink() {
        // Its URL is the way to open it; there is nothing in storage to sign a link for.
        long taskId = createTask("Open by URL");
        long id = addLink(taskId, ARTICLE, "Opened directly").extract().jsonPath().getLong("id");

        given().when().get("/api/tasks/" + taskId + "/attachments/" + id + "/link").then().statusCode(404);
        given().when().get("/api/tasks/" + taskId + "/attachments/" + id + "/thumbnail-link").then().statusCode(404);
        given().when().post("/api/tasks/" + taskId + "/attachments/" + id + "/confirm").then().statusCode(200)
            .body("url", equalTo(ARTICLE));
    }

    @Test
    @TestSecurity(user = "link-remove@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "link-remove@example.com") })
    void shouldRemoveALink() {
        long taskId = createTask("Remove the link");
        long id = addLink(taskId, ARTICLE, "Gone soon").extract().jsonPath().getLong("id");

        given().when().delete("/api/tasks/" + taskId + "/attachments/" + id).then().statusCode(204);

        assertEquals(0L, QuarkusTransaction.requiringNew().call(() -> Attachment.count("id", id)));
    }

    @Test
    @TestSecurity(user = "link-undo@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "link-undo@example.com") })
    void shouldBringALinkBackWithItsTasksUndoAndSweepItAfterTheWindow() {
        long taskId = createTask("Deleted with a link");
        long id = addLink(taskId, ARTICLE, "Kept for the undo").extract().jsonPath().getLong("id");

        given().when().delete("/api/tasks/" + taskId).then().statusCode(204);
        long recreated = given().contentType(ContentType.JSON)
            .body(Map.of("description", "Deleted with a link", "dueDate", LocalDate.now().plusDays(1).toString(),
                "importance", TaskImportance.MEDIUM.name(), "state", TaskState.TODO.name(),
                "attachmentIds", List.of(id)))
            .when().post("/api/tasks").then().statusCode(201).extract().jsonPath().getLong("id");
        given().when().get("/api/tasks").then()
            .body("find { it.id == " + recreated + " }.attachments.url", equalTo(List.of(ARTICLE)));

        given().when().delete("/api/tasks/" + recreated).then().statusCode(204);
        attachments.sweep(Instant.now().plus(Duration.ofHours(2)));
        assertEquals(0L, QuarkusTransaction.requiringNew().call(() -> Attachment.count("id", id)));
    }

    @Test
    @TestSecurity(user = "file-has-no-url@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "file-has-no-url@example.com") })
    void shouldNotTakeAFileAnnouncedAsALink() {
        // The link's type is no file's: announcing one would make a link with an object and no URL.
        long taskId = createTask("Not a file");

        given().contentType(ContentType.JSON)
            .body(Map.of("fileName", "links.txt", "contentType", AttachmentKind.LINK.contentType(), "sizeBytes", 10))
            .when().post("/api/tasks/" + taskId + "/attachments").then()
            .statusCode(422).body("refusal", equalTo("UNSUPPORTED_TYPE"));
    }

    @Test
    @TestSecurity(user = "file-url@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "file-url@example.com") })
    void shouldListAFileWithoutAUrl() {
        long taskId = createTask("A file");

        given().contentType(ContentType.JSON)
            .body(Map.of("fileName", "a.pdf", "contentType", AttachmentKind.PDF.contentType(), "sizeBytes", 10))
            .when().post("/api/tasks/" + taskId + "/attachments").then()
            .statusCode(201).body("attachment.url", nullValue());
    }

    private static long createTask(String description) {
        return given().contentType(ContentType.JSON)
            .body(Map.of("description", description, "dueDate", LocalDate.now().plusDays(1).toString(),
                "importance", TaskImportance.MEDIUM.name(), "state", TaskState.TODO.name()))
            .when().post("/api/tasks").then().statusCode(201).extract().jsonPath().getLong("id");
    }

    private static ValidatableResponse addLink(long taskId, String url, String title) {
        Map<String, Object> body = new HashMap<>();
        body.put("url", url);
        if (title != null) {
            body.put("title", title);
        }
        return given().contentType(ContentType.JSON).body(body)
            .when().post("/api/tasks/" + taskId + "/attachments/links").then();
    }
}
