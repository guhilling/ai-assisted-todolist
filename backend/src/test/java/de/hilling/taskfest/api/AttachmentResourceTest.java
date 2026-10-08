package de.hilling.taskfest.api;

import de.hilling.taskfest.attachment.Attachment;
import de.hilling.taskfest.attachment.AttachmentService;
import de.hilling.taskfest.attachment.AttachmentStore;
import de.hilling.taskfest.model.Task;
import de.hilling.taskfest.model.TaskImportance;
import de.hilling.taskfest.model.TaskState;
import de.hilling.taskfest.model.User;
import de.hilling.taskfest.service.UserService;
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
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;

import static io.restassured.RestAssured.given;
import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * A task's attachments end to end (#204), against S3 in LocalStack: announce, upload through the
 * presigned link, confirm, list, open, remove -- the limits, ownership, and a deleted task's
 * attachments surviving the undo window and then being swept.
 *
 * <p>Identity is faked by {@code @TestSecurity}; S3 is real enough to sign and check links. Each
 * test signs in as its own user, because the per-user limit would otherwise make them depend on
 * one another.</p>
 */
@QuarkusTest
@TestProfile(AttachmentStorageProfile.class)
class AttachmentResourceTest {

    private static final byte[] PDF = "%PDF-1.7 a very small document".getBytes(StandardCharsets.UTF_8);

    private final HttpClient http = HttpClient.newHttpClient();

    @Inject
    AttachmentService attachments;

    @Inject
    AttachmentStore store;

    @Inject
    UserService users;

    @Inject
    S3Client s3;

    @Test
    @TestSecurity(user = "journey@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "journey@example.com") })
    void shouldUploadListOpenAndRemoveAFile() throws Exception {
        long taskId = createTask("Pay the invoice");

        JsonPath announced = announce(taskId, "Rechnung März.pdf", "application/pdf", PDF.length).statusCode(201)
            .extract().jsonPath();
        long id = announced.getLong("attachment.id");
        String key = objectKeyOf(id);
        assertEquals(200, upload(announced, PDF));

        confirm(taskId, id).statusCode(200).body("fileName", equalTo("Rechnung März.pdf"));
        given().when().get("/api/tasks").then().statusCode(200)
            .body("find { it.id == " + taskId + " }.attachments.fileName", equalTo(List.of("Rechnung März.pdf")));

        String link = given().when().get("/api/tasks/" + taskId + "/attachments/" + id + "/link")
            .then().statusCode(200).extract().path("url");
        HttpResponse<byte[]> opened = http.send(HttpRequest.newBuilder(URI.create(link)).build(),
            HttpResponse.BodyHandlers.ofByteArray());
        assertArrayEquals(PDF, opened.body());
        assertThat(opened.headers().firstValue("content-disposition").orElse(""), containsString("inline"));

        given().when().delete("/api/tasks/" + taskId + "/attachments/" + id).then().statusCode(204);
        given().when().get("/api/tasks").then()
            .body("find { it.id == " + taskId + " }.attachments", empty());
        assertTrue(store.head(key).isEmpty());
    }

    @Test
    @TestSecurity(user = "too-long@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "too-long@example.com") })
    void shouldHaveS3RefuseAFileOfAnotherSizeThanAnnounced() throws Exception {
        long taskId = createTask("Scan the receipt");
        JsonPath announced = announce(taskId, "receipt.pdf", "application/pdf", PDF.length).statusCode(201)
            .extract().jsonPath();

        // The size is signed into the link: one byte more and S3 itself says no.
        byte[] longer = (new String(PDF, StandardCharsets.UTF_8) + "!").getBytes(StandardCharsets.UTF_8);
        assertEquals(403, upload(announced, longer));
        confirm(taskId, announced.getLong("attachment.id")).statusCode(409);
    }

    @Test
    @TestSecurity(user = "twice@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "twice@example.com") })
    void shouldConfirmAnUploadTwiceWithTheSameAnswer() throws Exception {
        // A retried confirm -- the first answer lost on the way -- must not fail the upload.
        long taskId = createTask("Retry the confirm");
        JsonPath announced = announce(taskId, "twice.pdf", "application/pdf", PDF.length).extract().jsonPath();
        long id = announced.getLong("attachment.id");
        upload(announced, PDF);

        confirm(taskId, id).statusCode(200);
        confirm(taskId, id).statusCode(200).body("id", equalTo((int) id));
    }

    @Test
    @TestSecurity(user = "mismatch@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "mismatch@example.com") })
    void shouldDeleteAFileThatArrivedOtherThanAnnounced() {
        // The signed link makes this impossible through the front door; written straight into the
        // bucket, it stands for whatever might one day get past it.
        long taskId = createTask("Check what arrived");
        long id = announce(taskId, "page.pdf", "application/pdf", PDF.length).extract().jsonPath()
            .getLong("attachment.id");
        String key = objectKeyOf(id);
        s3.putObject(put -> put.bucket("taskfest-attachments").key(key).contentType("text/html"),
            RequestBody.fromBytes(PDF));

        confirm(taskId, id).statusCode(422).body("refusal", equalTo("MISMATCH"));
        assertTrue(store.head(key).isEmpty());
        confirm(taskId, id).statusCode(404);
    }

    @Test
    @TestSecurity(user = "pending@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "pending@example.com") })
    void shouldOfferNoLinkForAFileThatHasNotArrivedOrDoesNotExist() {
        long taskId = createTask("Nothing to open yet");
        long id = announce(taskId, "later.png", "image/png", 10).extract().jsonPath().getLong("attachment.id");

        given().when().get("/api/tasks/" + taskId + "/attachments/" + id + "/link").then().statusCode(404);
        given().when().get("/api/tasks/" + taskId + "/attachments/" + (id + 1000) + "/link").then().statusCode(404);
    }

    @Test
    @TestSecurity(user = "early@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "early@example.com") })
    void shouldNotConfirmAnUploadThatHasNotArrived() {
        long taskId = createTask("Wait for the scan");
        long id = announce(taskId, "scan.png", "image/png", 10).statusCode(201).extract().jsonPath().getLong("attachment.id");

        confirm(taskId, id).statusCode(409);
    }

    @Test
    @TestSecurity(user = "refused@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "refused@example.com") })
    void shouldRefuseAnUnsupportedTypeAndAFileTooLarge() {
        long taskId = createTask("Collect the paperwork");

        announce(taskId, "page.html", "text/html", 10).statusCode(422).body("refusal", equalTo("UNSUPPORTED_TYPE"));
        announce(taskId, "huge.pdf", "application/pdf", 10L * 1024 * 1024 + 1).statusCode(422)
            .body("refusal", equalTo("TOO_LARGE"));
    }

    @Test
    @TestSecurity(user = "full-task@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "full-task@example.com") })
    void shouldRefuseAThirdAttachmentOnATask() {
        long taskId = createTask("Two pictures at most");
        announce(taskId, "one.jpg", "image/jpeg", 10).statusCode(201);
        announce(taskId, "two.jpg", "image/jpeg", 10).statusCode(201);

        announce(taskId, "three.jpg", "image/jpeg", 10).statusCode(422).body("refusal", equalTo("TASK_FULL"));
    }

    @Test
    @TestSecurity(user = "full-user@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "full-user@example.com") })
    void shouldRefuseASixthAttachmentForAUser() {
        for (int task = 0; task < 3; task++) {
            long taskId = createTask("Task " + task);
            for (int file = 0; file < (task < 2 ? 2 : 1); file++) {
                announce(taskId, "f" + file + ".png", "image/png", 10).statusCode(201);
            }
        }

        announce(createTask("One too many"), "six.png", "image/png", 10).statusCode(422)
            .body("refusal", equalTo("USER_FULL"));
    }

    @Test
    @TestSecurity(user = "intruder@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "intruder@example.com") })
    void shouldAnswerSomeoneElsesTaskAndAttachmentLikeMissingOnes() {
        long[] victims = QuarkusTransaction.requiringNew().call(() -> {
            User victim = users.getOrCreateByEmail("victim@example.com");
            Task task = newTask(victim, "Private");
            task.persist();
            Attachment attachment = attachments.announce(victim, task, "secret.pdf", "application/pdf", 10).attachment();
            return new long[] { task.id, attachment.id };
        });

        announce(victims[0], "mine.pdf", "application/pdf", 10).statusCode(404);
        given().when().get("/api/tasks/" + victims[0] + "/attachments/" + victims[1] + "/link").then().statusCode(404);
        given().when().delete("/api/tasks/" + victims[0] + "/attachments/" + victims[1]).then().statusCode(404);
    }

    @Test
    @TestSecurity(user = "undo@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "undo@example.com") })
    void shouldBringADeletedTasksAttachmentsBackWithItsUndo() throws Exception {
        long taskId = createTask("Deleted by mistake");
        JsonPath announced = announce(taskId, "plan.pdf", "application/pdf", PDF.length).extract().jsonPath();
        long id = announced.getLong("attachment.id");
        upload(announced, PDF);
        confirm(taskId, id).statusCode(200);

        given().when().delete("/api/tasks/" + taskId).then().statusCode(204);

        // The board's undo re-creates the task, naming the attachments it had.
        long restored = given().contentType(ContentType.JSON)
            .body(Map.of("description", "Deleted by mistake", "dueDate", LocalDate.now().plusDays(1).toString(),
                "importance", TaskImportance.MEDIUM.name(), "state", TaskState.TODO.name(), "attachmentIds", List.of(id)))
            .when().post("/api/tasks").then().statusCode(201).extract().jsonPath().getLong("id");

        given().when().get("/api/tasks").then()
            .body("find { it.id == " + restored + " }.attachments.id", equalTo(List.of((int) id)));
        assertTrue(store.head(objectKeyOf(id)).isPresent());
    }

    @Test
    @TestSecurity(user = "empty-undo@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "empty-undo@example.com") })
    void shouldCreateATaskWithAnEmptyListOfAttachmentsToBringBack() {
        given().contentType(ContentType.JSON)
            .body(Map.of("description", "Had none", "dueDate", LocalDate.now().plusDays(1).toString(),
                "importance", TaskImportance.MEDIUM.name(), "state", TaskState.TODO.name(), "attachmentIds", List.of()))
            .when().post("/api/tasks").then().statusCode(201).body("attachments", empty());
    }

    @Test
    @TestSecurity(user = "sweep@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "sweep@example.com") })
    void shouldSweepADeletedTasksAttachmentsOnceTheUndoWindowHasPassed() throws Exception {
        long taskId = createTask("Gone for good");
        JsonPath announced = announce(taskId, "old.pdf", "application/pdf", PDF.length).extract().jsonPath();
        long id = announced.getLong("attachment.id");
        upload(announced, PDF);
        confirm(taskId, id).statusCode(200);
        String key = objectKeyOf(id);
        given().when().delete("/api/tasks/" + taskId).then().statusCode(204);

        // Within the window: kept.
        attachments.sweep(Instant.now());
        assertTrue(store.head(key).isPresent());

        // Past it: row and object gone.
        attachments.sweep(Instant.now().plus(Duration.ofMinutes(11)));
        assertTrue(store.head(key).isEmpty());
        assertEquals(0L, QuarkusTransaction.requiringNew().call(() -> Attachment.count("id", id)));
    }

    @Test
    @TestSecurity(user = "stale@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "stale@example.com") })
    void shouldSweepAnUploadThatNeverArrived() {
        long taskId = createTask("Never uploaded");
        long id = announce(taskId, "lost.png", "image/png", 10).statusCode(201).extract().jsonPath().getLong("attachment.id");

        attachments.sweep(Instant.now().plus(Duration.ofHours(2)));

        assertEquals(0L, QuarkusTransaction.requiringNew().call(() -> Attachment.count("id", id)));
    }

    private long createTask(String description) {
        return given().contentType(ContentType.JSON)
            .body(Map.of("description", description, "dueDate", LocalDate.now().plusDays(1).toString(),
                "importance", TaskImportance.MEDIUM.name(), "state", TaskState.TODO.name()))
            .when().post("/api/tasks").then().statusCode(201).extract().jsonPath().getLong("id");
    }

    private static io.restassured.response.ValidatableResponse announce(long taskId, String name, String type, long size) {
        return given().contentType(ContentType.JSON)
            .body(Map.of("fileName", name, "contentType", type, "sizeBytes", size))
            .when().post("/api/tasks/" + taskId + "/attachments").then();
    }

    private static io.restassured.response.ValidatableResponse confirm(long taskId, long id) {
        return given().when().post("/api/tasks/" + taskId + "/attachments/" + id + "/confirm").then();
    }

    /** PUTs the content to the presigned link with the headers it was signed for, as the browser would. */
    private int upload(JsonPath announced, byte[] content) throws IOException, InterruptedException {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(announced.getString("url")))
            .PUT(HttpRequest.BodyPublishers.ofByteArray(content));
        Map<String, String> headers = announced.getMap("headers");
        headers.forEach(request::header);
        return http.send(request.build(), HttpResponse.BodyHandlers.discarding()).statusCode();
    }

    private static String objectKeyOf(long id) {
        return QuarkusTransaction.requiringNew().call(() -> Attachment.<Attachment>findById(id).objectKey);
    }

    private static Task newTask(User owner, String description) {
        Task task = new Task();
        task.owner = owner;
        task.description = description;
        task.dueDate = LocalDate.now().plusDays(1);
        task.importance = TaskImportance.LOW;
        task.state = TaskState.TODO;
        return task;
    }
}
