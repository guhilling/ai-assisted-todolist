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
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * The scheduled sweep (#204, D3) as the scheduler calls it, with the clock it really has: an upload
 * announced long enough ago is deleted, and a sweep with nothing due changes nothing.
 * {@code AttachmentResourceTest} covers what the sweep deletes in detail, passing it the time.
 *
 * <p>The scheduler itself is off in tests, so the method is called directly; that it is scheduled
 * at all is the annotation's business.</p>
 */
@QuarkusTest
@TestProfile(AttachmentStorageProfile.class)
class AttachmentSweepTest {

    @Inject
    AttachmentSweep sweep;

    @Inject
    AttachmentService attachments;

    @Inject
    UserService users;

    @Test
    void shouldDeleteAnUploadThatNeverArrivedAndThenFindNothingMore() {
        long id = QuarkusTransaction.requiringNew().call(() -> {
            User owner = users.getOrCreateByEmail("scheduled-sweep@example.com");
            Task task = new Task();
            task.owner = owner;
            task.description = "Never uploaded";
            task.dueDate = LocalDate.now().plusDays(1);
            task.importance = TaskImportance.LOW;
            task.state = TaskState.TODO;
            task.persist();
            Attachment attachment = attachments.announce(owner, task, "lost.pdf", "application/pdf", 10).attachment();
            Attachment.update("createdAt = ?1 where id = ?2", Instant.now().minus(Duration.ofHours(2)), attachment.id);
            return attachment.id;
        });

        sweep.sweep();
        assertEquals(0L, QuarkusTransaction.requiringNew().call(() -> Attachment.count("id", id)));

        sweep.sweep();
        assertEquals(0L, QuarkusTransaction.requiringNew().call(() -> Attachment.count("id", id)));
    }
}
