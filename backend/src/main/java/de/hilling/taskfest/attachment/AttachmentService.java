package de.hilling.taskfest.attachment;

import de.hilling.taskfest.model.Task;
import de.hilling.taskfest.model.User;
import io.quarkus.narayana.jta.QuarkusTransaction;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.transaction.Transactional;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Attaching files to tasks (#204): announcing an upload, confirming it, opening, removing, and what
 * happens to a task's attachments when it is deleted and undone.
 *
 * <p>The database and S3 cannot change in one transaction, so every step orders its two halves to
 * fail safely: an upload is announced (row, pending) before the link is handed out and confirmed
 * by asking S3; a removal deletes the object before the row, so a failure leaves a row pointing at
 * nothing -- reported by the clean-up job of #208 -- rather than an object nobody can find. A
 * deleted task's attachments are detached, not deleted, and swept once the undo window has passed
 * (D3).</p>
 */
@ApplicationScoped
public class AttachmentService {

    private static final Logger LOG = LoggerFactory.getLogger(AttachmentService.class);

    private final AttachmentStore store;
    private final AttachmentsConfig config;
    private final AttachmentPolicy policy;

    AttachmentService(AttachmentStore store, AttachmentsConfig config) {
        this.store = store;
        this.config = config;
        this.policy = new AttachmentPolicy(config.maxSizeBytes(), config.maxPerTask(), config.maxPerUser());
    }

    /** An attachment refused for one of the policy's reasons, or because its content did not match. */
    public static final class Refused extends RuntimeException {
        private final String reason;

        Refused(String reason) {
            super("Attachment refused: " + reason);
            this.reason = reason;
        }

        /** @return why: an {@link AttachmentPolicy.Refusal}'s name, {@code UNSUPPORTED_TYPE} or {@code MISMATCH} */
        public String reason() {
            return reason;
        }
    }

    /**
     * An announced attachment and the link its content is uploaded with.
     *
     * @param attachment the attachment, pending
     * @param upload the link that accepts exactly the announced file
     */
    public record Announced(Attachment attachment, AttachmentStore.UploadLink upload) {
    }

    /**
     * Announces an upload: checks the type and the limits, records the attachment as pending and
     * hands out a link that only accepts exactly this file's size and type.
     *
     * @throws Refused when the type is not allowed or a limit is reached
     */
    @Transactional
    public Announced announce(User owner, Task task, String fileName, String contentType, long sizeBytes) {
        AttachmentKind kind = AttachmentKind.of(contentType).orElseThrow(() -> new Refused("UNSUPPORTED_TYPE"));
        long onTask = Attachment.count("task", task);
        long ofUser = Attachment.count("owner", owner);
        policy.refusal(sizeBytes, onTask, ofUser).ifPresent(refusal -> {
            throw new Refused(refusal.name());
        });

        Attachment attachment = new Attachment();
        attachment.task = task;
        attachment.owner = owner;
        attachment.fileName = AttachmentPolicy.cleanFileName(fileName);
        attachment.kind = kind;
        attachment.sizeBytes = sizeBytes;
        attachment.objectKey = UUID.randomUUID().toString();
        attachment.persist();
        return new Announced(attachment,
            store.uploadLink(attachment.objectKey, kind, sizeBytes, config.uploadLinkLifetime()));
    }

    /**
     * Confirms an upload: the object must be in S3 with the announced size and type, which the
     * signed link already enforced; this is the check that it arrived at all. A mismatch -- which
     * the link should make impossible -- deletes object and row.
     *
     * @return the attachment, available; empty when the upload has not arrived yet
     * @throws Refused when what arrived is not what was announced
     */
    public Optional<Attachment> confirm(Attachment attachment) {
        if (attachment.state == AttachmentState.AVAILABLE) {
            return Optional.of(attachment);
        }
        var head = store.head(attachment.objectKey);
        if (head.isEmpty()) {
            return Optional.empty();
        }
        boolean matches = head.get().contentLength() == attachment.sizeBytes
            && AttachmentKind.of(head.get().contentType()).filter(kind -> kind == attachment.kind).isPresent();
        if (!matches) {
            remove(attachment);
            throw new Refused("MISMATCH");
        }
        QuarkusTransaction.requiringNew().run(() ->
            Attachment.update("state = ?1 where id = ?2", AttachmentState.AVAILABLE, attachment.id));
        attachment.state = AttachmentState.AVAILABLE;
        return Optional.of(attachment);
    }

    /** A link the owner's browser opens the file with. */
    public AttachmentStore.DownloadLink link(Attachment attachment) {
        return store.downloadLink(attachment.objectKey, attachment.kind, attachment.fileName,
            config.downloadLinkLifetime());
    }

    /** Removes an attachment: the object first, then the row. */
    public void remove(Attachment attachment) {
        store.delete(attachment.objectKey);
        QuarkusTransaction.requiringNew().run(() -> Attachment.delete("id", attachment.id));
    }

    /**
     * The owner's attachment with this id on this task, or empty -- for someone else's, too, which
     * an API therefore answers like a missing one.
     */
    public Optional<Attachment> find(User owner, Task task, Long id) {
        return Attachment.<Attachment>find("id = ?1 and owner = ?2 and task = ?3", id, owner, task)
            .firstResultOptional();
    }

    /** The available attachments of each of these tasks, in one query, by task id. */
    public Map<Long, List<Attachment>> availableOf(Collection<Task> tasks) {
        if (tasks.isEmpty()) {
            return Map.of();
        }
        return Attachment.<Attachment>find("task in ?1 and state = ?2 order by id", tasks, AttachmentState.AVAILABLE)
            .stream()
            .collect(Collectors.groupingBy(attachment -> attachment.task.id));
    }

    /** Detaches a task's attachments before it is deleted, keeping them for the undo window (D3). */
    @Transactional
    public void detachAll(Task task) {
        Attachment.update("task = null, detachedAt = ?1 where task = ?2", Instant.now(), task);
    }

    /**
     * Attaches detached attachments to the task an undo re-created: only the owner's, only ones
     * still detached, and only within the undo window. Anything else is ignored rather than
     * refused, since undo is best effort by nature.
     */
    @Transactional
    public void reattach(User owner, Task task, Collection<Long> ids) {
        if (ids == null || ids.isEmpty()) {
            return;
        }
        Attachment.update("task = ?1, detachedAt = null where id in ?2 and owner = ?3 and detachedAt >= ?4",
            task, ids, owner, Instant.now().minus(config.undoWindow()));
    }

    /**
     * Deletes what is no longer wanted: attachments detached longer than the undo window, and
     * uploads announced longer ago than they may stay pending. Each on its own, so one failure does
     * not stop the rest.
     *
     * @return how many were deleted
     */
    public int sweep(Instant now) {
        List<Attachment> due = QuarkusTransaction.requiringNew().call(() -> Attachment.<Attachment>list(
            "(detachedAt is not null and detachedAt < ?1) or (state = ?2 and createdAt < ?3)",
            now.minus(config.undoWindow()), AttachmentState.PENDING, now.minus(config.pendingLifetime())));
        int deleted = 0;
        for (Attachment attachment : due) {
            try {
                remove(attachment);
                deleted++;
            } catch (RuntimeException failure) {
                LOG.warn("Could not sweep attachment {}; the next sweep tries again", attachment.id, failure);
            }
        }
        return deleted;
    }
}
