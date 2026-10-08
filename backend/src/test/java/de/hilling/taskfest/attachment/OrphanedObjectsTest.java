package de.hilling.taskfest.attachment;

import de.hilling.taskfest.model.Task;
import de.hilling.taskfest.model.TaskImportance;
import de.hilling.taskfest.model.TaskState;
import de.hilling.taskfest.model.User;
import de.hilling.taskfest.service.UserService;
import de.hilling.taskfest.support.AttachmentStorageProfile;
import io.quarkus.narayana.jta.QuarkusTransaction;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The clean-up of objects no attachment refers to (#208), against S3 in LocalStack.
 *
 * <p>S3 cannot backdate an object, so the job is handed the time it runs at: "two days from now"
 * stands for an object left behind long ago. The bucket is shared with the other attachment
 * tests, so each test asserts about its own keys only.</p>
 */
@QuarkusTest
@TestProfile(AttachmentStorageProfile.class)
class OrphanedObjectsTest {

    private static final String BUCKET = "taskfest-attachments";

    @Inject
    OrphanedObjects orphans;

    @Inject
    AttachmentStore store;

    @Inject
    OrphanSweep schedule;

    @Inject
    S3Client s3;

    @Inject
    UserService users;

    @Test
    void shouldDeleteAnObjectNothingRefersToOnceItIsOlderThanTheMargin() {
        String key = putObject();
        // Life went on after the object was left behind: the database is not older than it. A
        // minute later rather than "now", because LocalStack's clock is the container's, which
        // can run a little ahead of this JVM's.
        attachment(AttachmentState.AVAILABLE, Instant.now().plus(Duration.ofMinutes(1)));

        OrphanedObjects.Report report = orphans.sweep(Instant.now().plus(Duration.ofDays(2)));

        assertThat(report.deletedKeys(), hasItem(key));
        assertTrue(store.head(key).isEmpty());
    }

    @Test
    void shouldLeaveAnObjectYoungerThanTheMarginAlone() {
        // It may be an upload under way, whose row is about to be written or was just confirmed.
        String key = putObject();

        OrphanedObjects.Report report = orphans.sweep(Instant.now());

        assertThat(report.deletedKeys(), not(hasItem(key)));
        assertTrue(store.head(key).isPresent());
    }

    @Test
    void shouldLeaveAnObjectAnAttachmentRefersTo() {
        Attachment attachment = attachment(AttachmentState.AVAILABLE);
        putObject(attachment.objectKey);

        OrphanedObjects.Report report = orphans.sweep(Instant.now().plus(Duration.ofDays(2)));

        assertThat(report.deletedKeys(), not(hasItem(attachment.objectKey)));
        assertTrue(store.head(attachment.objectKey).isPresent());
    }

    @Test
    void shouldReportButKeepAnAvailableAttachmentWhoseObjectIsMissing() {
        // Deleting rows is a decision about someone's data, so this is said, not repaired.
        Attachment attachment = attachment(AttachmentState.AVAILABLE);

        OrphanedObjects.Report report = orphans.sweep(Instant.now());

        assertThat(report.attachmentsWithoutObject(), hasItem(attachment.id));
        assertTrue(QuarkusTransaction.requiringNew().call(() -> Attachment.count("id", attachment.id)) == 1L);
    }

    @Test
    void shouldNotReportAPendingAttachmentWhoseUploadHasNotArrived() {
        Attachment attachment = attachment(AttachmentState.PENDING);

        OrphanedObjects.Report report = orphans.sweep(Instant.now());

        assertThat(report.attachmentsWithoutObject(), not(hasItem(attachment.id)));
    }

    @Test
    void shouldRunAsTheSchedulerCallsIt() {
        // The scheduler is off in tests; this is what it calls, with the real clock. The count
        // proves the run reached the bucket; the young object proves the clock is the real one.
        String key = putObject();

        OrphanedObjects.Report report = schedule.run();

        assertTrue(report.listed() >= 1);
        assertTrue(store.head(key).isPresent());
    }

    private String putObject() {
        return putObject(UUID.randomUUID().toString());
    }

    private String putObject(String key) {
        s3.putObject(put -> put.bucket(BUCKET).key(key).contentType("application/pdf"), RequestBody.fromString("%PDF"));
        return key;
    }

    private Attachment attachment(AttachmentState state) {
        return attachment(state, Instant.now());
    }

    private Attachment attachment(AttachmentState state, Instant createdAt) {
        return QuarkusTransaction.requiringNew().call(() -> {
            User owner = users.getOrCreateByEmail("orphans-" + UUID.randomUUID() + "@example.com");
            Task task = new Task();
            task.owner = owner;
            task.description = "Has a file";
            task.dueDate = LocalDate.now().plusDays(1);
            task.importance = TaskImportance.LOW;
            task.state = TaskState.TODO;
            task.persist();
            Attachment attachment = new Attachment();
            attachment.task = task;
            attachment.owner = owner;
            attachment.fileName = "file.pdf";
            attachment.kind = AttachmentKind.PDF;
            attachment.sizeBytes = 4L;
            attachment.objectKey = UUID.randomUUID().toString();
            attachment.state = state;
            attachment.createdAt = createdAt;
            attachment.persist();
            return attachment;
        });
    }
}
