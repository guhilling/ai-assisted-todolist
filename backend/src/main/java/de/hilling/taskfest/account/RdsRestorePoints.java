package de.hilling.taskfest.account;

import java.time.Instant;
import java.util.Objects;
import java.util.Optional;
import java.util.stream.Stream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import software.amazon.awssdk.core.exception.SdkException;
import software.amazon.awssdk.services.rds.RdsClient;
import software.amazon.awssdk.services.rds.model.DBInstanceAutomatedBackup;
import software.amazon.awssdk.services.rds.model.DBSnapshot;

/**
 * The oldest restorable point of one RDS instance (#213), from RDS's listing of its snapshots --
 * manual ones, the final snapshots {@code env.sh down} leaves, and the automated daily ones -- and
 * of any automated backups retained after the instance was deleted.
 *
 * <p>It never guesses in the direction that deletes: a listing that cannot be had, or that lists
 * nothing at all, answers "unknown", which keeps every record. An empty listing is far likelier a
 * wrong instance name than a database without a single backup.</p>
 */
public class RdsRestorePoints implements RestorePoints {

    private static final Logger LOG = LoggerFactory.getLogger(RdsRestorePoints.class);

    private final RdsClient rds;
    private final String instance;

    /**
     * @param rds the client to ask
     * @param instance the instance identifier, such as {@code taskfest-qa-db}
     */
    public RdsRestorePoints(RdsClient rds, String instance) {
        this.rds = rds;
        this.instance = instance;
    }

    @Override
    public Optional<Instant> oldest() {
        try {
            // Every page: final snapshots pile up with each `down`, and the oldest may be on the last.
            Stream<Instant> snapshots = rds.describeDBSnapshotsPaginator(
                    request -> request.dbInstanceIdentifier(instance))
                .dbSnapshots().stream().map(DBSnapshot::snapshotCreateTime);
            Stream<Instant> backups = rds.describeDBInstanceAutomatedBackupsPaginator(
                    request -> request.dbInstanceIdentifier(instance))
                .dbInstanceAutomatedBackups().stream()
                .map(DBInstanceAutomatedBackup::restoreWindow)
                .filter(window -> window != null && window.earliestTime() != null)
                .map(window -> window.earliestTime());
            return Stream.concat(snapshots, backups).filter(Objects::nonNull).min(Instant::compareTo);
        } catch (SdkException failure) {
            LOG.warn("Could not list the restorable points of {}; keeping every deletion record", instance, failure);
            return Optional.empty();
        }
    }
}
