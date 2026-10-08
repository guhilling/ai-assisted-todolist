package de.hilling.taskfest.account;

import de.hilling.taskfest.attachment.Attachment;
import de.hilling.taskfest.attachment.AttachmentService;
import de.hilling.taskfest.model.Task;
import de.hilling.taskfest.model.User;
import io.quarkus.narayana.jta.QuarkusTransaction;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Deletes an account with everything it holds (#213): every task, every attachment -- record and
 * file -- and the user.
 *
 * <p>The order is what makes it safe to repeat. The deletion record is written first, so an
 * attempt that fails half way is finished by the next one, or by the replay after a restart. Then
 * each attachment goes as attachments always do, file before record. Last, in one transaction with
 * the user's row locked against a racing upload, whatever attachment records remain, the tasks,
 * and the user; a file an upload slipped in meanwhile is an orphan the clean-up of #208 removes.</p>
 */
@ApplicationScoped
public class AccountDeletion {

    private static final Logger LOG = LoggerFactory.getLogger(AccountDeletion.class);

    private final DeletionRecords records;
    private final AttachmentService attachments;

    AccountDeletion(DeletionRecords records, AttachmentService attachments) {
        this.records = records;
        this.attachments = attachments;
    }

    /** Deletes the account with this email, recording when, and logs counts -- never the address. */
    public void delete(String email) {
        records.record(email, Instant.now());
        purge(email);
    }

    /**
     * Deletes the account's data without writing a record: for the replay, which acts on one.
     * Doing nothing for an account that does not exist is what makes a repeat harmless.
     */
    void purge(String email) {
        User user = QuarkusTransaction.requiringNew().call(() -> User.<User>find("email", email).firstResult());
        if (user == null) {
            return;
        }
        List<Attachment> held = QuarkusTransaction.requiringNew().call(() ->
            Attachment.<Attachment>list("owner", user));
        held.forEach(attachments::remove);

        long tasks = QuarkusTransaction.requiringNew().call(() -> {
            User locked = User.findById(user.id, LockModeType.PESSIMISTIC_WRITE);
            if (locked == null) {
                return 0L;
            }
            Attachment.delete("owner", locked);
            long deleted = Task.delete("owner", locked);
            locked.delete();
            return deleted;
        });
        LOG.info("Deleted account {}: {} task(s), {} attachment(s)", user.id, tasks, held.size());
    }
}
