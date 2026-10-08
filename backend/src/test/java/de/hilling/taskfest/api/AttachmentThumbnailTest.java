package de.hilling.taskfest.api;

import de.hilling.taskfest.attachment.Attachment;
import de.hilling.taskfest.attachment.AttachmentStore;
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
import io.restassured.path.json.JsonPath;
import io.restassured.response.ValidatableResponse;
import jakarta.inject.Inject;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.matchesPattern;
import static org.hamcrest.Matchers.notNullValue;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * A preview thumbnail stored alongside an image (#236), against S3 in LocalStack.
 *
 * <p>The browser makes the thumbnail -- it has the file already -- and uploads it next to the
 * original through a second signed link; the row shows it instead of the full photo. A thumbnail
 * is optional throughout: one that is not offered, does not fit or never arrives costs the
 * attachment nothing, and the row shows the original as before. Links are handed out again while
 * they are fresh, so the browser's cache can keep what it fetched.</p>
 */
@QuarkusTest
@TestProfile(AttachmentStorageProfile.class)
class AttachmentThumbnailTest {

    private static final byte[] PHOTO = "pretend this is a large JPEG".getBytes(StandardCharsets.UTF_8);
    private static final byte[] THUMBNAIL = "small".getBytes(StandardCharsets.UTF_8);

    private final HttpClient http = HttpClient.newHttpClient();

    @Inject
    AttachmentStore store;

    @Test
    @TestSecurity(user = "thumbs@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "thumbs@example.com") })
    void shouldStoreAThumbnailAlongsideAnImageAndOpenIt() throws Exception {
        long taskId = createTask("Holiday photo");
        JsonPath announced = announce(taskId, "beach.jpg", "image/jpeg", PHOTO.length, (long) THUMBNAIL.length)
            .statusCode(201)
            .body("thumbnailUpload.url", notNullValue())
            .extract().jsonPath();
        long id = announced.getLong("attachment.id");
        assertEquals(200, put(announced.getString("url"), announced.getMap("headers"), PHOTO));
        assertEquals(200, put(announced.getString("thumbnailUpload.url"), announced.getMap("thumbnailUpload.headers"),
            THUMBNAIL));

        confirm(taskId, id).statusCode(200).body("thumbnail", equalTo(true));

        String link = given().when().get("/api/tasks/" + taskId + "/attachments/" + id + "/thumbnail-link")
            .then().statusCode(200).extract().jsonPath().getString("url");
        HttpResponse<byte[]> opened = http.send(HttpRequest.newBuilder(URI.create(link)).build(),
            HttpResponse.BodyHandlers.ofByteArray());
        assertEquals(200, opened.statusCode());
        assertArrayEquals(THUMBNAIL, opened.body());
    }

    @Test
    @TestSecurity(user = "nothumb@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "nothumb@example.com") })
    void shouldConfirmAnImageWhoseThumbnailNeverArrivedWithoutOne() throws Exception {
        long taskId = createTask("Thumbnail lost");
        JsonPath announced = announce(taskId, "lost.jpg", "image/jpeg", PHOTO.length, (long) THUMBNAIL.length)
            .statusCode(201).extract().jsonPath();
        long id = announced.getLong("attachment.id");
        put(announced.getString("url"), announced.getMap("headers"), PHOTO);

        confirm(taskId, id).statusCode(200).body("thumbnail", equalTo(false));
        given().when().get("/api/tasks/" + taskId + "/attachments/" + id + "/thumbnail-link").then().statusCode(404);
    }

    @Test
    @TestSecurity(user = "pdfthumb@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "pdfthumb@example.com") })
    void shouldOfferNoThumbnailLinkForAPdfOrAThumbnailTooLarge() {
        long taskId = createTask("No thumbnails here");

        announce(taskId, "scan.pdf", "application/pdf", 100, 10L).statusCode(201).body("thumbnailUpload", nullValue());
        announce(taskId, "huge.jpg", "image/jpeg", 100, 1024L * 1024).statusCode(201)
            .body("thumbnailUpload", nullValue());
    }

    @Test
    @TestSecurity(user = "emptythumb@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "emptythumb@example.com") })
    void shouldNotRefuseTheFileForAnEmptyThumbnail() {
        long taskId = createTask("Empty canvas");

        announce(taskId, "empty.jpg", "image/jpeg", 100, 0L).statusCode(201).body("thumbnailUpload", nullValue());
    }

    @Test
    @TestSecurity(user = "plain@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "plain@example.com") })
    void shouldAnnounceAnImageWithoutAThumbnailAsBefore() {
        long taskId = createTask("Old browser");

        announce(taskId, "plain.png", "image/png", 100, null).statusCode(201)
            .body("thumbnailUpload", nullValue())
            .body("attachment.thumbnail", equalTo(false));
    }

    @Test
    @TestSecurity(user = "goneboth@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "goneboth@example.com") })
    void shouldRemoveTheThumbnailWithTheFile() throws Exception {
        long taskId = createTask("Remove both");
        JsonPath announced = announce(taskId, "both.jpg", "image/jpeg", PHOTO.length, (long) THUMBNAIL.length)
            .statusCode(201).extract().jsonPath();
        long id = announced.getLong("attachment.id");
        put(announced.getString("url"), announced.getMap("headers"), PHOTO);
        put(announced.getString("thumbnailUpload.url"), announced.getMap("thumbnailUpload.headers"), THUMBNAIL);
        confirm(taskId, id).statusCode(200);
        String thumbnailKey = Attachment.thumbnailKey(objectKeyOf(id));
        assertTrue(store.head(thumbnailKey).isPresent());

        given().when().delete("/api/tasks/" + taskId + "/attachments/" + id).then().statusCode(204);

        assertTrue(store.head(thumbnailKey).isEmpty());
    }

    @Test
    @TestSecurity(user = "cached@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "cached@example.com") })
    void shouldHandOutTheSameLinkWhileItIsFreshAndLetTheBrowserKeepIt() throws Exception {
        long taskId = createTask("Cache me");
        JsonPath announced = announce(taskId, "cache.jpg", "image/jpeg", PHOTO.length, null)
            .statusCode(201).extract().jsonPath();
        long id = announced.getLong("attachment.id");
        put(announced.getString("url"), announced.getMap("headers"), PHOTO);
        confirm(taskId, id).statusCode(200);
        String path = "/api/tasks/" + taskId + "/attachments/" + id + "/link";

        String first = given().when().get(path).then().statusCode(200)
            // The browser may keep the answer itself, so it does not even ask again.
            .header("Cache-Control", containsString("private"))
            .header("Cache-Control", matchesPattern(".*max-age=[1-9][0-9]*.*"))
            .extract().jsonPath().getString("url");
        String second = given().when().get(path).then().statusCode(200).extract().jsonPath().getString("url");

        assertEquals(first, second);
        // And storage tells it to keep the file for as long as the link lasts.
        HttpResponse<byte[]> opened = http.send(HttpRequest.newBuilder(URI.create(first)).build(),
            HttpResponse.BodyHandlers.ofByteArray());
        assertTrue(opened.headers().firstValue("Cache-Control").orElse("").contains("max-age="),
            "storage should send Cache-Control, sent " + opened.headers().map());
    }

    private long createTask(String description) {
        return given().contentType(ContentType.JSON)
            .body(Map.of("description", description, "dueDate", LocalDate.now().plusDays(1).toString(),
                "importance", TaskImportance.MEDIUM.name(), "state", TaskState.TODO.name()))
            .when().post("/api/tasks").then().statusCode(201).extract().jsonPath().getLong("id");
    }

    private static ValidatableResponse announce(long taskId, String name, String type, long size, Long thumbnailSize) {
        Map<String, Object> body = new HashMap<>(Map.of("fileName", name, "contentType", type, "sizeBytes", size));
        if (thumbnailSize != null) {
            body.put("thumbnailSizeBytes", thumbnailSize);
        }
        return given().contentType(ContentType.JSON).body(body)
            .when().post("/api/tasks/" + taskId + "/attachments").then();
    }

    private static ValidatableResponse confirm(long taskId, long id) {
        return given().when().post("/api/tasks/" + taskId + "/attachments/" + id + "/confirm").then();
    }

    /** PUTs the content to a presigned link with the headers it was signed for, as the browser would. */
    private int put(String url, Map<String, String> headers, byte[] content) throws IOException, InterruptedException {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(url))
            .PUT(HttpRequest.BodyPublishers.ofByteArray(content));
        headers.forEach(request::header);
        return http.send(request.build(), HttpResponse.BodyHandlers.discarding()).statusCode();
    }

    private static String objectKeyOf(long id) {
        return QuarkusTransaction.requiringNew().call(() -> Attachment.<Attachment>findById(id).objectKey);
    }
}
