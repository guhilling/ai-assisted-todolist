package de.hilling.taskfest.api;

import de.hilling.taskfest.account.DeletionRecords;
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
import jakarta.inject.Inject;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Deleting one's own account (#213) end to end, against S3 in LocalStack: every task, every
 * attachment row and file, and the user go; a deletion record stays behind; nobody else's data is
 * touched; and a deletion interrupted half way is finished by asking again.
 *
 * <p>Identity is faked by {@code @TestSecurity}; each test deletes its own user.</p>
 */
@QuarkusTest
@TestProfile(AttachmentStorageProfile.class)
class AccountResourceTest {

    private static final String BUCKET = "taskfest-attachments";

    @Inject
    UserService users;

    @Inject
    AttachmentService attachments;

    @Inject
    AttachmentStore store;

    @Inject
    DeletionRecords records;

    @Inject
    S3Client s3;

    @Test
    @TestSecurity(user = "leaving@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "leaving@example.com") })
    void shouldDeleteEverythingTheCallerHolds() {
        Holdings holdings = holdingsOf("leaving@example.com");

        given().when().delete("/api/account").then().statusCode(204);

        assertEquals(0L, count(() -> Task.count("id", holdings.taskId())));
        assertEquals(0L, count(() -> Attachment.count("id", holdings.attachmentId())));
        assertEquals(0L, count(() -> User.count("email", "leaving@example.com")));
        assertTrue(store.head(holdings.objectKey()).isEmpty());
        assertTrue(records.deletedAt("leaving@example.com").isPresent());
    }

    @Test
    @TestSecurity(user = "neighbour-leaves@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "neighbour-leaves@example.com") })
    void shouldLeaveEveryoneElsesDataAlone() {
        holdingsOf("neighbour-leaves@example.com");
        Holdings stays = holdingsOf("stays@example.com");

        given().when().delete("/api/account").then().statusCode(204);

        assertEquals(1L, count(() -> Task.count("id", stays.taskId())));
        assertEquals(1L, count(() -> Attachment.count("id", stays.attachmentId())));
        assertTrue(store.head(stays.objectKey()).isPresent());
        assertTrue(records.deletedAt("stays@example.com").isEmpty());
    }

    @Test
    @TestSecurity(user = "interrupted@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "interrupted@example.com") })
    void shouldFinishADeletionThatWasInterruptedHalfWay() {
        // As if a first attempt had deleted the file and then failed: its row is still there.
        Holdings holdings = holdingsOf("interrupted@example.com");
        store.delete(holdings.objectKey());

        given().when().delete("/api/account").then().statusCode(204);

        assertEquals(0L, count(() -> Attachment.count("id", holdings.attachmentId())));
        assertEquals(0L, count(() -> User.count("email", "interrupted@example.com")));
    }

    @Test
    @TestSecurity(user = "nothing-yet@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "nothing-yet@example.com") })
    void shouldDeleteAnAccountThatHoldsNothing() {
        given().when().delete("/api/account").then().statusCode(204);

        assertEquals(0L, count(() -> User.count("email", "nothing-yet@example.com")));
    }

    @Test
    @TestSecurity(user = "cookies@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "cookies@example.com") })
    void shouldEndTheSessionInThisBrowser() {
        given().cookie("q_session", "x").cookie("q_session_chunk_1", "y")
            .when().delete("/api/account")
            .then().statusCode(204)
            .header("Set-Cookie", containsString("q_session=;"));
    }

    @Test
    @TestSecurity(user = "other-device@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "other-device@example.com") })
    void shouldStartANewEmptyAccountForASessionLeftOpenElsewhere() {
        // The account was deleted on another device; this session cannot be ended from the server,
        // and using it starts afresh, as signing in again would (Gunnar's decision on #224).
        holdingsOf("other-device@example.com");
        given().when().delete("/api/account").then().statusCode(204);

        given().when().get("/api/tasks").then().statusCode(200).body("size()", org.hamcrest.Matchers.is(0));

        assertEquals(1L, count(() -> User.count("email", "other-device@example.com")));
    }

    /** What a user holds: one task with one uploaded attachment. */
    private record Holdings(long taskId, long attachmentId, String objectKey) {
    }

    private Holdings holdingsOf(String email) {
        Holdings holdings = QuarkusTransaction.requiringNew().call(() -> {
            User owner = users.getOrCreateByEmail(email);
            Task task = new Task();
            task.owner = owner;
            task.description = "Belongs to " + email;
            task.dueDate = LocalDate.now().plusDays(1);
            task.importance = TaskImportance.LOW;
            task.state = TaskState.TODO;
            task.persist();
            Attachment attachment = attachments.announce(owner, task, "file.pdf", "application/pdf", 4).attachment();
            return new Holdings(task.id, attachment.id, attachment.objectKey);
        });
        s3.putObject(put -> put.bucket(BUCKET).key(holdings.objectKey()).contentType("application/pdf"),
            RequestBody.fromString("%PDF"));
        return holdings;
    }

    private static long count(java.util.concurrent.Callable<Long> query) {
        return QuarkusTransaction.requiringNew().call(query);
    }
}
