package de.hilling.taskfest.account;

import io.smallrye.config.ConfigMapping;
import io.smallrye.config.WithDefault;
import java.util.Optional;

/**
 * The {@code taskfest.account} configuration (#213): whether account deletions are recorded and
 * re-applied, when the replay runs, and which database's snapshots decide how long a record must
 * be kept.
 */
@ConfigMapping(prefix = "taskfest.account")
public interface AccountsConfig {

    /**
     * Whether deletions are recorded, checked and re-applied. Off only where there is no bucket to
     * keep records in: the plain test profile and the local container stack.
     */
    @WithDefault("true")
    boolean deletionsEnabled();

    /**
     * The RDS instance whose snapshots and backups could bring a deleted account back. Unset, as
     * everywhere but AWS, no record is ever pruned.
     */
    Optional<String> dbInstance();

    /** When the replay runs besides at start-up. */
    DeletionReplaySchedule deletionReplay();

    /** The replay's schedule, in the scheduler's notation ({@code 24h}). */
    interface DeletionReplaySchedule {

        /** How long after a start the first scheduled run comes; the start-up run is separate. */
        String delay();

        /** How often it runs after that. */
        String every();
    }
}
