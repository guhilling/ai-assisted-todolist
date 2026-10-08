package de.hilling.taskfest.attachment;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * What one run of the orphan clean-up (#208) will do, decided from a bucket listing and the
 * attachment rows alone -- no S3, no database -- so the decision has a plain unit test.
 *
 * <p>An object no attachment refers to is an orphan, and goes once it is older than the margin.
 * One guard stands between an unversioned bucket and a database that does not describe it: a
 * database holding no attachments at all deletes nothing, because that is an environment brought
 * up empty, not one whose every file is an orphan. Every orphan is counted, whatever its age and
 * whether or not the guard held, so an alert sees a database that does not match the bucket
 * within the hour, days before anything would be deleted (#208, Gunnar's decision).</p>
 *
 * @param deletions the keys to delete: orphans older than the margin, none when the guard holds
 * @param hold whether the empty-database guard held the run, or {@link Hold#NONE}
 * @param orphans how many objects no attachment refers to, of any age
 * @param alertable how many of them are older than an upload takes, which is what the alert counts
 * @param missingObjects the ids of available attachments whose object was not listed
 * @param listed how many objects the listing held
 */
public record OrphanPlan(List<String> deletions, Hold hold, int orphans, int alertable, List<Long> missingObjects,
                         int listed) {

    /** Why a run deleted nothing it otherwise would have. */
    public enum Hold {
        /** Nothing held it. */
        NONE,
        /** The database holds no attachments, so it cannot tell an orphan from a file. */
        NO_ATTACHMENTS
    }

    /**
     * What the run needs to know about one attachment, read in one query.
     *
     * @param id the attachment's id
     * @param objectKey its object's key
     * @param state whether it is pending or available
     */
    public record Row(Long id, String objectKey, AttachmentState state) {
    }

    /**
     * Decides a run.
     *
     * @param objects the bucket's listing
     * @param rows every attachment
     * @param now when the run happens
     * @param margin how old an orphan must be before it may go
     * @param alertAfter how old an orphan must be before it counts towards the alert: longer than an
     *     upload takes, so a file whose row was written just after the rows were read never pages
     * @return what to delete and what to report
     */
    public static OrphanPlan of(List<AttachmentStore.StoredObject> objects, List<Row> rows, Instant now,
                                Duration margin, Duration alertAfter) {
        Set<String> referenced = rows.stream().map(Row::objectKey).collect(Collectors.toSet());
        Set<String> listedKeys = objects.stream().map(AttachmentStore.StoredObject::key).collect(Collectors.toSet());
        List<Long> missing = rows.stream()
            .filter(row -> row.state() == AttachmentState.AVAILABLE && !listedKeys.contains(row.objectKey()))
            .map(Row::id)
            .toList();

        List<AttachmentStore.StoredObject> orphans = objects.stream()
            .filter(object -> !referenced.contains(object.key()))
            .toList();
        Instant settled = now.minus(alertAfter);
        int alertable = (int) orphans.stream().filter(object -> object.lastModified().isBefore(settled)).count();
        Instant oldEnough = now.minus(margin);
        Hold hold = rows.isEmpty() ? Hold.NO_ATTACHMENTS : Hold.NONE;
        List<String> deletions = hold != Hold.NONE ? List.of() : orphans.stream()
            .filter(object -> object.lastModified().isBefore(oldEnough))
            .map(AttachmentStore.StoredObject::key)
            .toList();
        return new OrphanPlan(deletions, hold, orphans.size(), alertable, missing, objects.size());
    }
}
