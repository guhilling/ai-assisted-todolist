package de.hilling.taskfest.account;

import de.hilling.taskfest.attachment.AttachmentStore;
import de.hilling.taskfest.model.Task;
import de.hilling.taskfest.model.TaskImportance;
import de.hilling.taskfest.model.TaskState;
import de.hilling.taskfest.model.User;
import de.hilling.taskfest.support.AttachmentStorageProfile;
import io.quarkus.narayana.jta.QuarkusTransaction;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Optional;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * A deletion re-applied after a database restore (#213, Gunnar's decision): the record outlives
 * the database, so an account a restore brought back is deleted again -- but only one created
 * before the deletion, so someone who signed up again afterwards keeps their new account.
 *
 * <p>A restore is simulated by writing a user and a task straight into the database, with the
 * creation time a restored row would carry.</p>
 */
@QuarkusTest
@TestProfile(AttachmentStorageProfile.class)
class DeletionReplayTest {

    @Inject
    DeletionRecords records;

    @Inject
    DeletionReplay replay;

    @Inject
    AttachmentStore store;

    @Inject
    AccountDeletion deletion;

    @Inject
    AccountsConfig config;

    @Test
    void shouldDeleteAgainAnAccountARestoreBroughtBack() {
        records.record("restored@example.com");
        long taskId = restoredUser("restored@example.com", Instant.now().minus(Duration.ofDays(30)));

        replay.run(false);

        assertEquals(0L, (long) QuarkusTransaction.requiringNew().call(() -> User.count("email", "restored@example.com")));
        assertEquals(0L, (long) QuarkusTransaction.requiringNew().call(() -> Task.count("id", taskId)));
    }

    @Test
    void shouldKeepAnAccountCreatedAfterTheDeletion() {
        // The record's time is when S3 wrote it; this account was created after that.
        records.record("came-back@example.com");
        restoredUser("came-back@example.com", Instant.now().plus(Duration.ofMinutes(1)));

        replay.run(false);

        assertEquals(1L, (long) QuarkusTransaction.requiringNew().call(() -> User.count("email", "came-back@example.com")));
    }

    @Test
    void shouldKeepTheRecordsOutOfTheOrphanCleanUpsListing() {
        records.record("listed@example.com");

        assertTrue(store.list().stream().noneMatch(object -> object.key().startsWith(DeletionRecords.PREFIX)));
    }

    @Test
    void shouldPruneARecordNoRestoreCanNeedAnyMore() {
        records.record("long-gone@example.com");
        // A database whose oldest snapshot is newer than the record: nothing can bring it back.
        DeletionReplay pruning = new DeletionReplay(records, deletion,
            () -> Optional.of(Instant.now().plus(Duration.ofDays(1))), config);

        pruning.run(true);

        assertTrue(records.deletedAt("long-gone@example.com").isEmpty());
    }

    @Test
    void shouldKeepEveryRecordWhenTheOldestSnapshotIsUnknown() {
        records.record("kept@example.com");

        replay.scheduled();

        assertTrue(records.deletedAt("kept@example.com").isPresent());
    }

    @Test
    void shouldTakeBackTheRecordOfADeletionThatDidNotGoThrough() {
        records.record("changed-mind@example.com");

        records.forget("changed-mind@example.com");

        assertTrue(records.deletedAt("changed-mind@example.com").isEmpty());
    }

    private static long restoredUser(String email, Instant createdAt) {
        return QuarkusTransaction.requiringNew().call(() -> {
            User user = new User();
            user.email = email;
            user.createdAt = createdAt;
            user.persist();
            Task task = new Task();
            task.owner = user;
            task.description = "Back from a snapshot";
            task.dueDate = LocalDate.now().plusDays(1);
            task.importance = TaskImportance.LOW;
            task.state = TaskState.TODO;
            task.persist();
            return task.id;
        });
    }
}
