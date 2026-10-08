package de.hilling.taskfest.attachment;

import io.quarkus.narayana.jta.QuarkusTransaction;
import jakarta.enterprise.context.ApplicationScoped;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Deletes objects in the attachment bucket that no attachment refers to (#208), and reports the
 * reverse.
 *
 * <p>An attachment lives in two places that cannot change in one transaction, and every step of
 * {@link AttachmentService} orders its halves so a failure leaves a row without an object rather
 * than the other way round. Not every failure can be ordered away -- a database restored from an
 * older snapshot forgets objects written since -- and an object nothing refers to would otherwise
 * stay forever, unopenable and billed. Only objects older than the margin go, so an upload under
 * way is never touched.</p>
 *
 * <p>The reverse, an available attachment whose object is missing, is only logged: deleting a row
 * is a decision about someone's data, and the row is the one thing that says what was lost. A
 * pending attachment has no object yet by definition and is not reported.</p>
 */
@ApplicationScoped
public class OrphanedObjects {

    private static final Logger LOG = LoggerFactory.getLogger(OrphanedObjects.class);

    private final AttachmentStore store;
    private final AttachmentsConfig config;

    OrphanedObjects(AttachmentStore store, AttachmentsConfig config) {
        this.store = store;
        this.config = config;
    }

    /**
     * What one run found and did.
     *
     * @param deletedKeys the keys of the objects deleted; keys are random and name no file
     * @param attachmentsWithoutObject the ids of available attachments whose object is missing
     */
    public record Report(List<String> deletedKeys, List<Long> attachmentsWithoutObject) {
    }

    /**
     * Runs the clean-up as of {@code now}: lists the bucket, compares it with the attachments, and
     * deletes each orphan older than the margin on its own, so one failure does not stop the rest.
     */
    public Report sweep(Instant now) {
        List<AttachmentStore.StoredObject> objects = store.list();
        Set<String> referenced = QuarkusTransaction.requiringNew().call(() -> new HashSet<>(
            Attachment.<Attachment>findAll().project(KeyOnly.class).stream().map(KeyOnly::objectKey).toList()));
        Instant oldEnough = now.minus(config.orphanMargin());

        List<String> deleted = objects.stream()
            .filter(object -> !referenced.contains(object.key()) && object.lastModified().isBefore(oldEnough))
            .map(AttachmentStore.StoredObject::key)
            .filter(this::delete)
            .toList();

        Set<String> stored = new HashSet<>(objects.stream().map(AttachmentStore.StoredObject::key).toList());
        List<Long> missing = QuarkusTransaction.requiringNew().call(() ->
            Attachment.<Attachment>list("state", AttachmentState.AVAILABLE).stream()
                .filter(attachment -> !stored.contains(attachment.objectKey))
                .map(attachment -> attachment.id)
                .toList());

        if (!deleted.isEmpty()) {
            LOG.info("Deleted {} object(s) no attachment refers to: {}", deleted.size(), deleted);
        }
        if (!missing.isEmpty()) {
            LOG.warn("{} available attachment(s) have no object in storage, kept for a person to look at: {}",
                missing.size(), missing);
        }
        return new Report(deleted, missing);
    }

    private boolean delete(String key) {
        try {
            store.delete(key);
            return true;
        } catch (RuntimeException failure) {
            LOG.warn("Could not delete orphaned object {}; the next run tries again", key, failure);
            return false;
        }
    }

    /**
     * The one column the comparison needs, so the run does not load every attachment whole.
     *
     * @param objectKey the attachment's object key
     */
    record KeyOnly(String objectKey) {
    }
}
