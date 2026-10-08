package de.hilling.taskfest.attachment;

import io.quarkus.narayana.jta.QuarkusTransaction;
import jakarta.enterprise.context.ApplicationScoped;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;

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

    /** The run line's fields, and the alert line's: the field the alarm's metric filter matches. */
    static final String RUN_LISTED = "orphanSweepListed";
    static final String RUN_ORPHANS = "orphanSweepOrphans";
    static final String RUN_DELETED = "orphanSweepDeleted";
    static final String ALERT = "orphanSweepAlert";

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
     * @param orphans how many objects no attachment refers to, of any age
     * @param alerted whether the run raised the alert: more settled orphans than the threshold
     * @param deletedKeys the keys of the objects deleted; keys are random and name no file
     * @param hold why the run deleted nothing it otherwise would have, or {@code NONE}
     * @param attachmentsWithoutObject the ids of available attachments whose object is missing
     */
    public record Report(int listed, int orphans, boolean alerted, List<String> deletedKeys, OrphanPlan.Hold hold,
                         List<Long> attachmentsWithoutObject) {
    }

    /**
     * Runs the clean-up as of {@code now}. The rows are read before the bucket is listed, so a file
     * uploaded in between is unknown to the rows and too young to go, never mistaken for an orphan.
     */
    public Report sweep(Instant now) {
        List<OrphanPlan.Row> rows = QuarkusTransaction.requiringNew().call(() ->
            Attachment.<Attachment>findAll().project(OrphanPlan.Row.class).list());
        OrphanPlan plan = OrphanPlan.of(store.list(), rows, now, config.orphanMargin(), config.pendingLifetime());

        List<String> deleted = deleteEach(plan.deletions(), store::delete);
        List<Long> missing = stillMissing(plan.missingObjects());
        boolean alerted = plan.alertable() > config.orphanSweep().alertAbove();

        withFields(Map.of(RUN_LISTED, String.valueOf(plan.listed()), RUN_ORPHANS, String.valueOf(plan.orphans()),
                RUN_DELETED, String.valueOf(deleted.size())),
            () -> LOG.info("Orphan clean-up: {} object(s) listed, {} orphan(s), {} deleted",
                plan.listed(), plan.orphans(), deleted.size()));
        if (alerted) {
            withFields(Map.of(ALERT, "true"), () -> LOG.warn(
                "{} object(s) older than an hour have no attachment referring to them; more than {}. "
                    + "A database restored from an older snapshot, or started empty, looks like this, "
                    + "and orphans are deleted after {}.",
                plan.alertable(), config.orphanSweep().alertAbove(), config.orphanMargin()));
        }
        if (!deleted.isEmpty()) {
            LOG.info("Deleted {} object(s) no attachment refers to: {}", deleted.size(), deleted);
        }
        if (plan.hold() == OrphanPlan.Hold.NO_ATTACHMENTS && plan.listed() > 0) {
            LOG.warn("The database holds no attachments but the bucket holds {} object(s); deleted none.",
                plan.listed());
        }
        if (!missing.isEmpty()) {
            LOG.warn("{} available attachment(s) have no object in storage, kept for a person to look at: {}",
                missing.size(), missing);
        }
        return new Report(plan.listed(), plan.orphans(), alerted, deleted, plan.hold(), missing);
    }

    /** Logs with these fields on the line, and only on it, as the other structured lines do. */
    private static void withFields(Map<String, String> fields, Runnable log) {
        fields.forEach(MDC::put);
        try {
            log.run();
        } finally {
            fields.keySet().forEach(MDC::remove);
        }
    }

    /**
     * Deletes each key on its own, so one failure does not stop the rest; a failed one is logged
     * and left for the next run.
     *
     * @return the keys that were deleted
     */
    static List<String> deleteEach(List<String> keys, Consumer<String> delete) {
        return keys.stream().filter(key -> {
            try {
                delete.accept(key);
                return true;
            } catch (RuntimeException failure) {
                LOG.warn("Could not delete orphaned object {}; the next run tries again", key, failure);
                return false;
            }
        }).toList();
    }

    /**
     * The attachments among these that are still available and still without their object, checked
     * again in one query: one removed while the run was listing would otherwise be reported as lost.
     */
    private List<Long> stillMissing(List<Long> ids) {
        if (ids.isEmpty()) {
            return List.of();
        }
        List<Attachment> current = QuarkusTransaction.requiringNew().call(() ->
            Attachment.<Attachment>list("id in ?1 and state = ?2", ids, AttachmentState.AVAILABLE));
        return current.stream()
            .filter(attachment -> store.head(attachment.objectKey).isEmpty())
            .map(attachment -> attachment.id)
            .toList();
    }
}
