package de.hilling.taskfest.attachment;

/**
 * Where an attachment stands between being announced and being usable (#204).
 *
 * <p>Stored as the PostgreSQL enum {@code attachment_state}, which {@code AttachmentKindColumnTest}
 * keeps in step with these names.</p>
 */
public enum AttachmentState {
    /** An upload link has been handed out; the file is not confirmed to be in S3 yet. */
    PENDING,
    /** The file is in S3, with the size and type announced, and may be opened. */
    AVAILABLE
}
