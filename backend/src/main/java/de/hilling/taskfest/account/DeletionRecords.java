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

/**
 * The record a deleted account leaves behind (#213), so that a database restored from an older
 * snapshot does not bring the account back for good.
 *
 * <p>The record must outlive the database it is about, so it is not in the database: it is a small
 * object in the environment's attachment bucket, which a restore does not touch, under
 * {@code deleted-accounts/<SHA-256 of the email>}, holding the time of the deletion. The hash is
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

    /** Records that the account with this email was deleted at this time, replacing an older record. */
    public void record(String email, Instant deletedAt) {
        store.putText(PREFIX + hash(email), deletedAt.toString());
    }

    /** When the account with this email was deleted, if it ever was. */
    public Optional<Instant> deletedAt(String email) {
        return store.getText(PREFIX + hash(email)).map(text -> Instant.parse(text.strip()));
    }

    /** Every deletion on record. */
    public List<Deletion> all() {
        return store.listUnder(PREFIX).stream()
            .map(object -> object.key().substring(PREFIX.length()))
            .flatMap(emailHash -> store.getText(PREFIX + emailHash)
                .map(text -> new Deletion(emailHash, Instant.parse(text.strip())))
                .stream())
            .toList();
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
