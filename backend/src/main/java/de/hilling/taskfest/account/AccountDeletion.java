package de.hilling.taskfest.account;

import de.hilling.taskfest.attachment.Attachment;
import de.hilling.taskfest.attachment.AttachmentService;
import de.hilling.taskfest.model.Task;
import de.hilling.taskfest.model.User;
import io.quarkus.cache.CacheManager;
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
 * <p>The deletion record is written last, once everything is gone: a deletion that fails half way
 * is reported as failed, and must not be carried out later behind the user's back by the replay.
 * Asking again finishes it. Each attachment goes as attachments always do, file before record;
 * then, in one transaction with the user's row locked against a racing upload, whatever attachment
 * records remain, the tasks, and the user. A file an upload was still sending can land after that,
 * with nothing referring to it: the orphan clean-up of #208 removes it within seven days, which
 * the privacy policy says (Gunnar's decision on #224).</p>
 */
@ApplicationScoped
public class AccountDeletion {

    private static final Logger LOG = LoggerFactory.getLogger(AccountDeletion.class);

    /** The avatar cache {@code GravatarService} keys by email: a deleted address must not stay in it. */
    private static final String AVATAR_CACHE = "gravatar-avatars";

    private final DeletionRecords records;
    private final AttachmentService attachments;
    private final CacheManager caches;

    AccountDeletion(DeletionRecords records, AttachmentService attachments, CacheManager caches) {
        this.records = records;
        this.attachments = attachments;
        this.caches = caches;
    }

    /** Deletes the account with this email, then records when; logs counts, never the address. */
    public void delete(String email) {
        purge(email);
        records.record(email, Instant.now());
    }

    /**
     * Deletes the account's data without writing a record: for the replay, which acts on one.
     * Doing nothing for an account that does not exist is what makes a repeat harmless.
     */
    void purge(String email) {
        caches.getCache(AVATAR_CACHE).ifPresent(cache -> cache.invalidate(email).await().indefinitely());
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
