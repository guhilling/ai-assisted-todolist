package de.hilling.taskfest.attachment;

import io.smallrye.config.ConfigMapping;
import java.time.Duration;

/**
 * The {@code taskfest.attachments} configuration (#204): where the files go, the limits Gunnar
 * decided (D1), and how long the links and the undo window last.
 */
@ConfigMapping(prefix = "taskfest.attachments")
public interface AttachmentsConfig {

    /** The environment's attachment bucket. */
    String bucket();

    /** The largest file accepted, in bytes. */
    long maxSizeBytes();

    /** How many attachments one task may carry. */
    int maxPerTask();

    /** How many attachments one user may have altogether. */
    int maxPerUser();

    /** How long an upload link works: long enough for 10 MB on a slow line. */
    Duration uploadLinkLifetime();

    /** How long a download link works; the browser fetches it straight away. */
    Duration downloadLinkLifetime();

    /**
     * How long a deleted task's attachments are kept for undo (D3). Far beyond the board's eight
     * seconds, so a slow request or a tab left open never costs a file.
     */
    Duration undoWindow();

    /** How long an announced upload may stay unconfirmed before it is swept. */
    Duration pendingLifetime();
}
