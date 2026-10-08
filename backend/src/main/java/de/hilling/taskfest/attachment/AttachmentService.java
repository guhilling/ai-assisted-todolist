package de.hilling.taskfest.attachment;

import de.hilling.taskfest.model.Task;
import de.hilling.taskfest.model.User;
import io.quarkus.narayana.jta.QuarkusTransaction;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.persistence.LockModeType;
import jakarta.transaction.Transactional;
import java.time.Duration;
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
 *
 * <p>An image may bring a preview thumbnail (#236), made by the browser and stored next to the file
 * ({@link Attachment#thumbnailKey}). It is optional at every step: one not offered, too large or
 * never uploaded leaves the attachment as it would have been without, and it goes wherever the
 * file goes.</p>
 */
@ApplicationScoped
public class AttachmentService {

    private static final Logger LOG = LoggerFactory.getLogger(AttachmentService.class);

    /** What a thumbnail is: a JPEG, which every browser's canvas can write. */
    private static final String THUMBNAIL_TYPE = "image/jpeg";

    private final AttachmentStore store;
    private final AttachmentsConfig config;
    private final AttachmentPolicy policy;
    private final ReusedLinks links;

    AttachmentService(AttachmentStore store, AttachmentsConfig config) {
        this.store = store;
        this.config = config;
        this.policy = new AttachmentPolicy(config.maxSizeBytes(), config.maxPerTask(), config.maxPerUser());
        this.links = new ReusedLinks(config.downloadLinkLifetime());
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
     * An announced attachment and the links its content is uploaded with.
     *
     * @param attachment the attachment, pending
     * @param upload the link that accepts exactly the announced file
     * @param thumbnailUpload the link for its preview thumbnail, when one was offered and fits
     */
    public record Announced(Attachment attachment, AttachmentStore.UploadLink upload,
                            Optional<AttachmentStore.UploadLink> thumbnailUpload) {
    }

    /** Announces an upload without a thumbnail; see {@link #announce(User, Task, String, String, long, Long)}. */
    public Announced announce(User owner, Task task, String fileName, String contentType, long sizeBytes) {
        return announce(owner, task, fileName, contentType, sizeBytes, null);
    }

    /**
     * Announces an upload: checks the type and the limits, records the attachment as pending and
     * hands out a link that only accepts exactly this file's size and type -- and, for an image whose
     * thumbnail fits, a second link for that.
     *
     * @param thumbnailSizeBytes the size of the preview thumbnail the browser made, or null for none
     * @throws Refused when the type is not allowed or a limit is reached
     */
    @Transactional
    public Announced announce(User owner, Task task, String fileName, String contentType, long sizeBytes,
                              Long thumbnailSizeBytes) {
        AttachmentKind kind = AttachmentKind.of(contentType).orElseThrow(() -> new Refused("UNSUPPORTED_TYPE"));
        lockAttachmentsOf(owner);
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
        Optional<AttachmentStore.UploadLink> thumbnailUpload = Optional.ofNullable(thumbnailSizeBytes)
            .filter(size -> kind.isImage() && size > 0 && size <= config.maxThumbnailBytes())
            .map(size -> store.uploadLink(Attachment.thumbnailKey(attachment.objectKey), THUMBNAIL_TYPE, size,
                config.uploadLinkLifetime()));
        return new Announced(attachment,
            store.uploadLink(attachment.objectKey, kind.contentType(), sizeBytes, config.uploadLinkLifetime()),
            thumbnailUpload);
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
        // The thumbnail's link signed its type and a size within the limit; this asks whether it came.
        boolean thumbnail = attachment.kind.isImage()
            && store.head(Attachment.thumbnailKey(attachment.objectKey))
                .filter(arrived -> THUMBNAIL_TYPE.equals(arrived.contentType()))
                .isPresent();
        int confirmed = QuarkusTransaction.requiringNew().call(() ->
            Attachment.update("state = ?1, thumbnail = ?3 where id = ?2", AttachmentState.AVAILABLE, attachment.id,
                thumbnail));
        if (confirmed == 0) {
            // Swept between the HEAD and here: it is gone, and was never available.
            return Optional.empty();
        }
        attachment.state = AttachmentState.AVAILABLE;
        attachment.thumbnail = thumbnail;
        return Optional.of(attachment);
    }

    /** A link the owner's browser opens the file with, the same one again while it is fresh. */
    public AttachmentStore.DownloadLink link(Attachment attachment) {
        return links.get(attachment.objectKey, Instant.now(), () -> store.downloadLink(attachment.objectKey,
            attachment.kind.contentType(), attachment.fileName, config.downloadLinkLifetime()));
    }

    /** A link to the attachment's preview thumbnail, the same one again while it is fresh; empty without one. */
    public Optional<AttachmentStore.DownloadLink> thumbnailLink(Attachment attachment) {
        if (!attachment.thumbnail) {
            return Optional.empty();
        }
        String key = Attachment.thumbnailKey(attachment.objectKey);
        return Optional.of(links.get(key, Instant.now(), () -> store.downloadLink(key, THUMBNAIL_TYPE,
            attachment.fileName, config.downloadLinkLifetime())));
    }

    /** How long the browser may keep an answer carrying this link: as long as it is handed out. */
    public Duration keepFor(AttachmentStore.DownloadLink link) {
        return links.keepFor(link, Instant.now());
    }

    /** Removes an attachment: the objects first, then the row. */
    public void remove(Attachment attachment) {
        deleteObjects(attachment);
        QuarkusTransaction.requiringNew().run(() -> Attachment.delete("id", attachment.id));
    }

    /** Deletes the file and the thumbnail it may have; deleting one that is not there is no error. */
    private void deleteObjects(Attachment attachment) {
        store.delete(attachment.objectKey);
        store.delete(Attachment.thumbnailKey(attachment.objectKey));
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
        lockAttachmentsOf(owner);
        // At most as many as the task may hold: an undo names one task's, but nothing stops a
        // request naming two deleted tasks' at once.
        long room = config.maxPerTask() - Attachment.count("task", task);
        // Changed as loaded entities, not by a bulk update, which would leave these instances
        // stale in the persistence context for the response read straight after.
        Attachment.<Attachment>find(
                "id in ?1 and owner = ?2 and task is null and detachedAt >= ?3 order by id",
                ids, owner, Instant.now().minus(config.undoWindow()))
            .stream()
            .limit(Math.max(room, 0))
            .forEach(attachment -> {
                attachment.task = task;
                attachment.detachedAt = null;
            });
    }

    /**
     * Serialises the changes that count a user's attachments, by locking the user's row: two
     * files announced at once -- a multi-file drop -- would otherwise both count the same total
     * and both fit.
     */
    private static void lockAttachmentsOf(User owner) {
        User.findById(owner.id, LockModeType.PESSIMISTIC_WRITE);
    }

    /** What the sweep deletes, as of ?1 minus the undo window and ?3 minus the pending lifetime. */
    private static final String DUE = "((detachedAt is not null and detachedAt < ?1)"
        + " or (state = ?2 and createdAt < ?3)"
        // A task deleted other than through the API: ON DELETE SET NULL, and nothing detached it.
        + " or (task is null and detachedAt is null))";

    /**
     * Deletes what is no longer wanted: attachments detached longer than the undo window, uploads
     * announced longer ago than they may stay pending, and attachments whose task went without
     * detaching them. Each on its own, so one failure does not stop the rest.
     *
     * @return how many were deleted
     */
    public int sweep(Instant now) {
        Instant undoneBefore = now.minus(config.undoWindow());
        Instant staleBefore = now.minus(config.pendingLifetime());
        List<Long> due = QuarkusTransaction.requiringNew().call(() -> Attachment.<Attachment>list(
                DUE, undoneBefore, AttachmentState.PENDING, staleBefore)
            .stream().map(attachment -> attachment.id).toList());
        int deleted = 0;
        for (Long id : due) {
            try {
                deleted += sweepOne(id, undoneBefore, staleBefore) ? 1 : 0;
            } catch (RuntimeException failure) {
                LOG.warn("Could not sweep attachment {}; the next sweep tries again", id, failure);
            }
        }
        return deleted;
    }

    /**
     * Deletes one attachment if it is still due, holding its row while the object goes: a confirm
     * or an undo that reached it since the list was read has made it wanted again, and must win.
     */
    private boolean sweepOne(Long id, Instant undoneBefore, Instant staleBefore) {
        return QuarkusTransaction.requiringNew().call(() -> {
            Attachment attachment = Attachment.<Attachment>find("id = ?4 and " + DUE,
                    undoneBefore, AttachmentState.PENDING, staleBefore, id)
                .withLock(LockModeType.PESSIMISTIC_WRITE)
                .firstResult();
            if (attachment == null) {
                return false;
            }
            deleteObjects(attachment);
            attachment.delete();
            return true;
        });
    }
}
