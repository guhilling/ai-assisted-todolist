package de.hilling.taskfest.attachment;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * What one run of the orphan clean-up (#208) will do, decided from a bucket listing and the
 * attachment rows alone -- no S3, no database -- so the decision has a plain unit test.
 *
 * <p>Three guards stand between an unversioned bucket and a database that does not describe it.
 * A database holding no attachments at all deletes nothing: that is an environment brought up
 * empty, not one whose every file is an orphan. An object newer than the newest attachment is
 * spared: a database older than the bucket is one restored from a snapshot, and the files written
 * since are not orphans to anyone who restores the right one. And more orphans than the limit
 * deletes none of them and says so, because a mass deletion is far likelier a mistake than a
 * backlog.</p>
 *
 * @param deletions the keys to delete, empty when a guard holds the run
 * @param hold which guard held the run, or {@link Hold#NONE}
 * @param orphans how many objects qualified as orphans before the limit was applied
 * @param missingObjects the ids of available attachments whose object was not listed
 * @param listed how many objects the listing held
 */
public record OrphanPlan(List<String> deletions, Hold hold, int orphans, List<Long> missingObjects, int listed) {

    /** Why a run deleted nothing it otherwise would have. */
    public enum Hold {
        /** Nothing held it. */
        NONE,
        /** The database holds no attachments, so it cannot tell an orphan from a file. */
        NO_ATTACHMENTS,
        /** More orphans than one run may delete. */
        TOO_MANY
    }

    /**
     * What the run needs to know about one attachment, read in one query.
     *
     * @param id the attachment's id
     * @param objectKey its object's key
     * @param state whether it is pending or available
     * @param createdAt when it was announced
     */
    public record Row(Long id, String objectKey, AttachmentState state, Instant createdAt) {
    }

    /**
     * Decides a run.
     *
     * @param objects the bucket's listing
     * @param rows every attachment
     * @param now when the run happens
     * @param margin how old an object must be before it may go
     * @param maxDeletions the most one run may delete
     * @return what to delete and what to report
     */
    public static OrphanPlan of(List<AttachmentStore.StoredObject> objects, List<Row> rows, Instant now,
                                Duration margin, int maxDeletions) {
        Set<String> referenced = rows.stream().map(Row::objectKey).collect(Collectors.toSet());
        Set<String> listedKeys = objects.stream().map(AttachmentStore.StoredObject::key).collect(Collectors.toSet());
        List<Long> missing = rows.stream()
            .filter(row -> row.state() == AttachmentState.AVAILABLE && !listedKeys.contains(row.objectKey()))
            .map(Row::id)
            .toList();

        Optional<Instant> newest = rows.stream().map(Row::createdAt).max(Instant::compareTo);
        Instant oldEnough = now.minus(margin);
        List<String> orphans = objects.stream()
            .filter(object -> !referenced.contains(object.key()))
            .filter(object -> object.lastModified().isBefore(oldEnough))
            .filter(object -> newest.map(limit -> !object.lastModified().isAfter(limit)).orElse(true))
            .map(AttachmentStore.StoredObject::key)
            .toList();

        Hold hold = Hold.NONE;
        if (newest.isEmpty()) {
            hold = Hold.NO_ATTACHMENTS;
        } else if (orphans.size() > maxDeletions) {
            hold = Hold.TOO_MANY;
        }
        return new OrphanPlan(hold == Hold.NONE ? orphans : List.of(), hold, orphans.size(), missing, objects.size());
    }
}
