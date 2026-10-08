package de.hilling.taskfest.attachment;

import java.util.Optional;

/**
 * The limits an attachment has to meet before an upload link is handed out (#204, D1).
 *
 * <p>Checked before the upload, against what the browser announces; the size is then enforced by
 * S3 itself, because it is signed into the upload link, and checked once more when the upload is
 * confirmed. The counts include attachments still pending and those detached from a deleted task
 * but still inside the undo window, so the limits cannot be passed by announcing without
 * uploading or by deleting and undoing. {@code AttachmentService} serialises the counting per
 * user, so they cannot be passed by announcing at once either.</p>
 */
public final class AttachmentPolicy {

    /** What a file name becomes when nothing of it survives cleaning. */
    static final String FALLBACK_FILE_NAME = "attachment";

    private final long maxSizeBytes;
    private final int maxPerTask;
    private final int maxPerUser;

    /**
     * @param maxSizeBytes the largest file accepted
     * @param maxPerTask how many attachments one task may carry
     * @param maxPerUser how many attachments one user may have altogether
     */
    public AttachmentPolicy(long maxSizeBytes, int maxPerTask, int maxPerUser) {
        this.maxSizeBytes = maxSizeBytes;
        this.maxPerTask = maxPerTask;
        this.maxPerUser = maxPerUser;
    }

    /** Why an attachment is refused. */
    public enum Refusal {
        EMPTY,
        TOO_LARGE,
        TASK_FULL,
        USER_FULL
    }

    /**
     * @param sizeBytes the announced size of the file
     * @param onTask how many attachments the task already has
     * @param ofUser how many attachments the user already has
     * @return why the attachment is refused, or empty when it may be uploaded
     */
    public Optional<Refusal> refusal(long sizeBytes, long onTask, long ofUser) {
        if (sizeBytes <= 0) {
            return Optional.of(Refusal.EMPTY);
        }
        if (sizeBytes > maxSizeBytes) {
            return Optional.of(Refusal.TOO_LARGE);
        }
        if (onTask >= maxPerTask) {
            return Optional.of(Refusal.TASK_FULL);
        }
        if (ofUser >= maxPerUser) {
            return Optional.of(Refusal.USER_FULL);
        }
        return Optional.empty();
    }

    /**
     * The name a file is listed and downloaded under: the original, without any path, line breaks
     * or quotes -- which would break the {@code Content-Disposition} header it travels in -- and
     * at most 255 characters.
     *
     * @param original what the browser said the file is called
     * @return the cleaned name, never blank
     */
    public static String cleanFileName(String original) {
        String name = original.substring(Math.max(original.lastIndexOf('/'), original.lastIndexOf('\\')) + 1);
        name = name.replaceAll("[\\p{Cntrl}]", "").replace('"', '_').strip();
        if (name.isEmpty()) {
            return FALLBACK_FILE_NAME;
        }
        return name.length() > Attachment.MAX_FILE_NAME_LENGTH
            ? name.substring(0, Attachment.MAX_FILE_NAME_LENGTH)
            : name;
    }
}
