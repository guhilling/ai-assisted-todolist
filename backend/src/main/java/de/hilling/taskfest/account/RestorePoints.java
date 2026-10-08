package de.hilling.taskfest.account;

import java.time.Instant;
import java.util.Optional;

/**
 * The oldest point the environment's database could be restored to (#213): a deletion record older
 * than that can no longer be needed, because nothing can bring its account back.
 */
public interface RestorePoints {

    /** The oldest restorable point, or empty when it cannot be known -- which keeps every record. */
    Optional<Instant> oldest();
}
