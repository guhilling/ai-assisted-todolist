package de.hilling.taskfest.attachment;

import io.quarkus.narayana.jta.QuarkusTransaction;
import jakarta.enterprise.context.ApplicationScoped;
import java.time.Instant;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Deletes objects in the attachment bucket that no attachment refers to (#208), and reports the
 * reverse. {@link OrphanPlan} decides; this reads, deletes and logs.
 *
 * <p>An attachment lives in two places that cannot change in one transaction, and every step of
 * {@link AttachmentService} deletes the object before the row, so a failure leaves a row without
 * an object rather than the other way round. What still leaves an object behind: an upload whose
 * row was swept while its file was arriving, or a database restored from a snapshot older than
 * files written since. Such an object would otherwise stay forever, unopenable and billed.</p>
 *
 * <p>The reverse, an available attachment whose object is missing, is only logged: deleting a row
 * is a decision about someone's data, and the row is the one thing that says what was lost.</p>
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
     * @param listed how many objects the bucket held
     * @param deletedKeys the keys of the objects deleted; keys are random and name no file
     * @param hold why the run deleted nothing it otherwise would have, or {@code NONE}
     * @param attachmentsWithoutObject the ids of available attachments whose object is missing
     */
    public record Report(int listed, List<String> deletedKeys, OrphanPlan.Hold hold,
                         List<Long> attachmentsWithoutObject) {
    }

    /**
     * Runs the clean-up as of {@code now}. The rows are read before the bucket is listed, so a file
     * uploaded in between is unknown to the rows and too young to go, never mistaken for an orphan.
     */
    public Report sweep(Instant now) {
        List<OrphanPlan.Row> rows = QuarkusTransaction.requiringNew().call(() ->
            Attachment.<Attachment>findAll().project(OrphanPlan.Row.class).list());
        OrphanPlan plan = OrphanPlan.of(store.list(), rows, now, config.orphanMargin(),
            config.orphanSweep().maxDeletions());

        List<String> deleted = plan.deletions().stream().filter(this::delete).toList();
        List<Long> missing = plan.missingObjects().stream().filter(this::stillMissing).toList();

        if (!deleted.isEmpty()) {
            LOG.info("Deleted {} object(s) no attachment refers to: {}", deleted.size(), deleted);
        }
        if (plan.hold() == OrphanPlan.Hold.TOO_MANY) {
            LOG.warn("{} object(s) qualify as orphans, more than the {} one run may delete; deleted none. "
                + "A database restored from the wrong snapshot looks like this.", plan.orphans(),
                config.orphanSweep().maxDeletions());
        } else if (plan.hold() == OrphanPlan.Hold.NO_ATTACHMENTS && plan.listed() > 0) {
            LOG.warn("The database holds no attachments but the bucket holds {} object(s); deleted none.",
                plan.listed());
        }
        if (!missing.isEmpty()) {
            LOG.warn("{} available attachment(s) have no object in storage, kept for a person to look at: {}",
                missing.size(), missing);
        }
        return new Report(plan.listed(), deleted, plan.hold(), missing);
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
     * Whether an attachment is still available and still without its object, checked again: one
     * removed while the run was listing would otherwise be reported as lost.
     */
    private boolean stillMissing(Long id) {
        Attachment attachment = QuarkusTransaction.requiringNew().call(() ->
            Attachment.<Attachment>find("id = ?1 and state = ?2", id, AttachmentState.AVAILABLE).firstResult());
        return attachment != null && store.head(attachment.objectKey).isEmpty();
    }
}
