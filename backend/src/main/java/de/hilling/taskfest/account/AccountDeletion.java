package de.hilling.taskfest.account;

import de.hilling.taskfest.attachment.Attachment;
import de.hilling.taskfest.attachment.AttachmentService;
import de.hilling.taskfest.model.Task;
import de.hilling.taskfest.model.User;
import de.hilling.taskfest.service.GravatarService;
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
 * <p>The deletion record is written first, so that no moment exists in which the account is gone
 * but unrecorded -- a crash then would leave a restore free to bring it back. If the deletion then
 * fails, the record is removed again before the failure is reported: a deletion the user is told
 * failed must not be carried out later by the replay. Each attachment goes as attachments always
 * do, file before record; then, in one transaction with the user's row locked against a racing
 * upload, whatever attachment records remain, the tasks, and the user. A file an upload was still
 * sending can land after that, with nothing referring to it: the orphan clean-up of #208 removes
 * it within seven days, which the privacy policy says (Gunnar's decision on #224).</p>
 *
 * <p>Where deletion records are switched off -- the Compose stacks, which have no bucket -- the
 * account is deleted without one.</p>
 */
@ApplicationScoped
public class AccountDeletion {

    private static final Logger LOG = LoggerFactory.getLogger(AccountDeletion.class);

    private final DeletionRecords records;
    private final AttachmentService attachments;
    private final CacheManager caches;
    private final AccountsConfig config;

    AccountDeletion(DeletionRecords records, AttachmentService attachments, CacheManager caches,
                    AccountsConfig config) {
        this.records = records;
        this.attachments = attachments;
        this.caches = caches;
        this.config = config;
    }

    /** Deletes the account with this email, recorded; logs counts, never the address. */
    public void delete(String email) {
        if (!config.deletionsEnabled()) {
            purge(email, Instant.MAX);
            return;
        }
        records.record(email);
        try {
            purge(email, Instant.MAX);
        } catch (RuntimeException failure) {
            records.forget(email);
            throw failure;
        }
    }

    /**
     * Deletes the account with this email and its data, without touching the record -- for the
     * replay, which acts on one. Only an account created before {@code createdBefore} is deleted,
     * checked again under the row lock, so an account someone created meanwhile is never taken for
     * the restored one. Doing nothing for an account that does not exist makes a repeat harmless.
     */
    void purge(String email, Instant createdBefore) {
        caches.getCache(GravatarService.AVATAR_CACHE)
            .ifPresentOrElse(cache -> cache.invalidate(email).await().indefinitely(),
                () -> LOG.warn("No cache {} to clear a deleted address from", GravatarService.AVATAR_CACHE));
        User user = QuarkusTransaction.requiringNew().call(() -> User.<User>find("email", email).firstResult());
        if (user == null || !user.createdAt.isBefore(createdBefore)) {
            return;
        }
        List<Attachment> held = QuarkusTransaction.requiringNew().call(() ->
            Attachment.<Attachment>list("owner", user));
        held.forEach(attachments::remove);

        long tasks = QuarkusTransaction.requiringNew().call(() -> {
            User locked = User.findById(user.id, LockModeType.PESSIMISTIC_WRITE);
            if (locked == null || !locked.createdAt.isBefore(createdBefore)) {
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
