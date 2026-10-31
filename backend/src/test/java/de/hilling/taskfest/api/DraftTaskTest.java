package de.hilling.taskfest.api;

import de.hilling.taskfest.attachment.Attachment;
import de.hilling.taskfest.attachment.AttachmentService;
import de.hilling.taskfest.attachment.AttachmentStore;
import de.hilling.taskfest.model.Task;
import de.hilling.taskfest.model.TaskImportance;
import de.hilling.taskfest.model.TaskState;
import de.hilling.taskfest.service.DraftSweep;
import de.hilling.taskfest.support.AttachmentStorageProfile;
import io.quarkus.narayana.jta.QuarkusTransaction;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.quarkus.test.security.TestSecurity;
import io.quarkus.test.security.oidc.Claim;
import io.quarkus.test.security.oidc.OidcSecurity;
import io.restassured.http.ContentType;
import io.restassured.path.json.JsonPath;
import jakarta.inject.Inject;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * A draft task's files (#381): what the app's add form uploads before Add, so they go up while the
 * form is filled in. Added with the task, discarded with the draft on Cancel, and swept with it once
 * abandoned for longer than an upload may stay pending. {@link DraftResourceTest} has the rest.
 *
 * <p>Against S3 in LocalStack, like {@link AttachmentResourceTest}; each test signs in as its own
 * user, because the per-user limit counts a draft's files too.</p>
 */
@QuarkusTest
@TestProfile(AttachmentStorageProfile.class)
class DraftTaskTest {

    private static final byte[] PDF = "%PDF-1.7 a draft's document".getBytes(StandardCharsets.UTF_8);

    private final HttpClient http = HttpClient.newHttpClient();

    @Inject
    AttachmentService attachments;

    @Inject
    AttachmentStore store;

    @Inject
    DraftSweep drafts;

    @Test
    @TestSecurity(user = "draft-added@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "draft-added@example.com") })
    void shouldAddADraftWithTheFilesUploadedToIt() throws Exception {
        long draftId = createDraft();
        long attachmentId = uploadTo(draftId, "Scan.pdf");

        given().contentType(ContentType.JSON).body(fields("File the scan"))
            .when().post("/api/tasks/drafts/" + draftId + "/add").then().statusCode(201)
            .body("id", equalTo((int) draftId))
            .body("description", equalTo("File the scan"))
            .body("attachments.id", equalTo(List.of((int) attachmentId)));

        given().when().get("/api/tasks").then().statusCode(200)
            .body("find { it.id == " + draftId + " }.attachments.fileName", equalTo(List.of("Scan.pdf")));
        // Added again, as a retry whose answer was lost does: the same task, its file still on it (#427).
        given().contentType(ContentType.JSON).body(fields("File the scan"))
            .when().post("/api/tasks/drafts/" + draftId + "/add").then().statusCode(201)
            .body("id", equalTo((int) draftId))
            .body("attachments.id", equalTo(List.of((int) attachmentId)));
    }

    @Test
    @TestSecurity(user = "draft-discarded@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "draft-discarded@example.com") })
    void shouldDiscardADraftWithItsFilesAtOnce() throws Exception {
        long draftId = createDraft();
        long attachmentId = uploadTo(draftId, "Unwanted.pdf");
        String key = objectKeyOf(attachmentId);

        given().when().delete("/api/tasks/drafts/" + draftId).then().statusCode(204);

        assertTrue(store.head(key).isEmpty());
        assertEquals(0L, QuarkusTransaction.requiringNew().call(() -> Attachment.count("id", attachmentId)));
        assertEquals(0L, QuarkusTransaction.requiringNew().call(() -> Task.count("id", draftId)));
    }

    @Test
    @TestSecurity(user = "draft-abandoned@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "draft-abandoned@example.com") })
    void shouldSweepAnAbandonedDraftWithItsFiles() throws Exception {
        long draftId = createDraft();
        long attachmentId = uploadTo(draftId, "Forgotten.pdf");
        String key = objectKeyOf(attachmentId);

        // Within the pending lifetime: kept, the form may still be open.
        drafts.sweep(Instant.now());
        assertEquals(1L, QuarkusTransaction.requiringNew().call(() -> Task.count("id", draftId)));

        drafts.sweep(Instant.now().plus(Duration.ofHours(2)));
        attachments.sweep(Instant.now());

        assertEquals(0L, QuarkusTransaction.requiringNew().call(() -> Task.count("id", draftId)));
        assertTrue(store.head(key).isEmpty());
        assertEquals(0L, QuarkusTransaction.requiringNew().call(() -> Attachment.count("id", attachmentId)));
    }

    private static long createDraft() {
        return given().when().post("/api/tasks/drafts").then().statusCode(201).extract().jsonPath().getLong("id");
    }

    private static Map<String, String> fields(String description) {
        return Map.of("description", description, "dueDate", LocalDate.now().plusDays(1).toString(),
            "importance", TaskImportance.MEDIUM.name(), "state", TaskState.TODO.name());
    }

    /** Announces, uploads and confirms a small PDF on the task or draft, as the app does. */
    private long uploadTo(long taskId, String name) throws IOException, InterruptedException {
        JsonPath announced = given().contentType(ContentType.JSON)
            .body(Map.of("fileName", name, "contentType", "application/pdf", "sizeBytes", PDF.length))
            .when().post("/api/tasks/" + taskId + "/attachments").then().statusCode(201).extract().jsonPath();
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(announced.getString("url")))
            .PUT(HttpRequest.BodyPublishers.ofByteArray(PDF));
        Map<String, String> headers = announced.getMap("headers");
        headers.forEach(request::header);
        assertEquals(200, http.send(request.build(), HttpResponse.BodyHandlers.discarding()).statusCode());
        long id = announced.getLong("attachment.id");
        given().when().post("/api/tasks/" + taskId + "/attachments/" + id + "/confirm").then().statusCode(200);
        return id;
    }

    private static String objectKeyOf(long id) {
        return QuarkusTransaction.requiringNew().call(() -> Attachment.<Attachment>findById(id).objectKey);
    }
}
