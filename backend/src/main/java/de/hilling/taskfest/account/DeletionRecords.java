package de.hilling.taskfest.account;

import de.hilling.taskfest.attachment.AttachmentStore;
import jakarta.enterprise.context.ApplicationScoped;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * The record a deleted account leaves behind (#213), so that a database restored from an older
 * snapshot does not bring the account back for good.
 *
 * <p>The record must outlive the database it is about, so it is not in the database: it is a small
 * object in the environment's attachment bucket, which a restore does not touch, under
 * {@code deleted-accounts/<SHA-256 of the email>}; its time is the object's own, as S3 keeps it. The hash is
 * what lets a restored account be recognised without keeping its address; it is pseudonymous, not
 * anonymous, and the privacy policy says so (Gunnar's decision on #213).</p>
 */
@ApplicationScoped
public class DeletionRecords {

    /** Where the records live in the bucket; attachment keys are bare, so the two never meet. */
    public static final String PREFIX = "deleted-accounts/";

    private final AttachmentStore store;

    DeletionRecords(AttachmentStore store) {
        this.store = store;
    }

    /**
     * A deletion on record.
     *
     * @param emailHash the SHA-256 of the account's email, in lower-case hex
     * @param deletedAt when the account was deleted
     */
    public record Deletion(String emailHash, Instant deletedAt) {
    }

    /**
     * Records that the account with this email is being deleted now, replacing an older record.
     * The time is the object's own; the body only says what the object is, for a person who finds it.
     */
    public void markDeleted(String email) {
        store.putText(PREFIX + hash(email), "TaskFest account deletion record (#213); the time is this object's.");
    }

    /** Removes the record of a deletion that did not go through. */
    public void forget(String email) {
        store.delete(PREFIX + hash(email));
    }

    /**
     * When the account with this email was deleted, if it ever was: the time the record was
     * written, which S3 keeps itself. The record's body says the same for a person reading it.
     */
    public Optional<Instant> deletedAt(String email) {
        return store.head(PREFIX + hash(email)).map(head -> head.lastModified());
    }

    /** Every deletion on record, in one listing: the times are the objects' own. */
    public List<Deletion> all() {
        return store.listUnder(PREFIX).stream()
            .map(object -> new Deletion(object.key().substring(PREFIX.length()), object.lastModified()))
            .toList();
    }

    /**
     * Removes a record that is no longer needed -- unless it was written again since it was read, in
     * which case it records a newer deletion and stays.
     */
    public void removeIfUnchanged(Deletion deletion) {
        String key = PREFIX + deletion.emailHash();
        boolean unchanged = store.head(key).map(head -> head.lastModified().equals(deletion.deletedAt())).orElse(false);
        if (unchanged) {
            store.delete(key);
        }
    }

    /**
     * The records no restore can make necessary again: those older than the oldest point the
     * database could be restored to, except any whose account is still there -- a re-deletion that
     * failed, which the next run must still be able to retry. None when that point is unknown.
     */
    public static List<Deletion> prunable(List<Deletion> records, Optional<Instant> oldestRestorable,
                                          Set<String> stillPresent) {
        return oldestRestorable
            .map(oldest -> records.stream()
                .filter(deletion -> deletion.deletedAt().isBefore(oldest))
                .filter(deletion -> !stillPresent.contains(deletion.emailHash()))
                .toList())
            .orElse(List.of());
    }

    /** The SHA-256 of the email exactly as the identity provider sent it, which is how users are keyed. */
    public static String hash(String email) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(email.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) {
            // Every Java platform is required to provide SHA-256.
            throw new IllegalStateException(impossible);
        }
    }
}
