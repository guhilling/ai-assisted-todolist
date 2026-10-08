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

    /**
     * How old an object must be before the orphan clean-up (#208) may delete it. Far beyond an
     * upload link's lifetime, so an upload under way -- whose row is being written or confirmed
     * while the object arrives -- is never mistaken for one left behind.
     */
    Duration orphanMargin();

    /** When the orphan clean-up runs; read by {@code OrphanSweep}'s schedule. */
    OrphanSweepSchedule orphanSweep();

    /** The orphan clean-up's schedule, in the scheduler's own notation ({@code 5m}, {@code 24h}). */
    interface OrphanSweepSchedule {

        /** How long after a start the first run comes, so it does not compete with startup. */
        String delay();

        /** How often it runs after that; {@code off} where there is no bucket to clean. */
        String every();

        /** The most objects one run may delete; more than that is held as a likely mistake. */
        int maxDeletions();
    }
}
