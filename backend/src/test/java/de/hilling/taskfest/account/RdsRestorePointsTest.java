package de.hilling.taskfest.account;

import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import software.amazon.awssdk.services.rds.RdsClient;
import software.amazon.awssdk.services.rds.model.DBInstanceAutomatedBackup;
import software.amazon.awssdk.services.rds.model.DBSnapshot;
import software.amazon.awssdk.services.rds.model.DescribeDbInstanceAutomatedBackupsRequest;
import software.amazon.awssdk.services.rds.model.DescribeDbInstanceAutomatedBackupsResponse;
import software.amazon.awssdk.services.rds.model.DescribeDbSnapshotsRequest;
import software.amazon.awssdk.services.rds.model.DescribeDbSnapshotsResponse;
import software.amazon.awssdk.services.rds.model.RdsException;
import software.amazon.awssdk.services.rds.model.RestoreWindow;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * The oldest point the environment's database could be restored to (#213), from RDS's own listing
 * of its snapshots and retained backups -- against a fake client, since LocalStack has no RDS.
 */
class RdsRestorePointsTest {

    private static final Instant SNAPSHOT = Instant.parse("2026-09-20T00:00:00Z");
    private static final Instant BACKUP = Instant.parse("2026-09-25T00:00:00Z");

    /** RDS answering with the given snapshot and backup times, for the instance asked about only. */
    private static RdsClient rds(Instant snapshot, Instant backup) {
        return new RdsClient() {
            @Override
            public DescribeDbSnapshotsResponse describeDBSnapshots(DescribeDbSnapshotsRequest request) {
                assertEquals("taskfest-qa-db", request.dbInstanceIdentifier());
                // Two pages, the older snapshot on the second, as with many final snapshots.
                if (request.marker() == null) {
                    return DescribeDbSnapshotsResponse.builder()
                        .dbSnapshots(DBSnapshot.builder().snapshotCreateTime(Instant.parse("2026-10-07T00:00:00Z")).build())
                        .marker("page-2")
                        .build();
                }
                return DescribeDbSnapshotsResponse.builder()
                    .dbSnapshots(snapshot == null ? java.util.List.of()
                        : java.util.List.of(DBSnapshot.builder().snapshotCreateTime(snapshot).build()))
                    .build();
            }

            @Override
            public DescribeDbInstanceAutomatedBackupsResponse describeDBInstanceAutomatedBackups(
                    DescribeDbInstanceAutomatedBackupsRequest request) {
                // A backup without a restore window, as RDS reports one still being created, is ignored.
                DBInstanceAutomatedBackup windowless = DBInstanceAutomatedBackup.builder().build();
                return DescribeDbInstanceAutomatedBackupsResponse.builder()
                    .dbInstanceAutomatedBackups(backup == null ? java.util.List.of(windowless)
                        : java.util.List.of(windowless, DBInstanceAutomatedBackup.builder()
                            .restoreWindow(RestoreWindow.builder().earliestTime(backup).build()).build()))
                    .build();
            }

            @Override
            public String serviceName() {
                return "rds";
            }

            @Override
            public void close() {
            }
        };
    }

    @Test
    void shouldTakeTheOldestOfSnapshotsAndRetainedBackups() {
        assertEquals(Optional.of(SNAPSHOT), new RdsRestorePoints(rds(SNAPSHOT, BACKUP), "taskfest-qa-db").oldest());
        assertEquals(Optional.of(BACKUP), new RdsRestorePoints(rds(null, BACKUP), "taskfest-qa-db").oldest());
    }

    @Test
    void shouldReadEveryPageOfSnapshots() {
        // SNAPSHOT is on the second page; the first holds only a newer one.
        assertEquals(Optional.of(SNAPSHOT), new RdsRestorePoints(rds(SNAPSHOT, null), "taskfest-qa-db").oldest());
    }

    @Test
    void shouldKnowNothingWhenRdsListsNothing() {
        // No restorable point at all is far likelier a wrong instance name than a database
        // without backups, so it keeps every record rather than deleting them all.
        assertEquals(Optional.empty(), new RdsRestorePoints(empty(), "taskfest-qa-db").oldest());
    }

    /** RDS listing nothing at all. */
    private static RdsClient empty() {
        return new RdsClient() {
            @Override
            public DescribeDbSnapshotsResponse describeDBSnapshots(DescribeDbSnapshotsRequest request) {
                return DescribeDbSnapshotsResponse.builder().build();
            }

            @Override
            public DescribeDbInstanceAutomatedBackupsResponse describeDBInstanceAutomatedBackups(
                    DescribeDbInstanceAutomatedBackupsRequest request) {
                return DescribeDbInstanceAutomatedBackupsResponse.builder().build();
            }

            @Override
            public String serviceName() {
                return "rds";
            }

            @Override
            public void close() {
            }
        };
    }

    @Test
    void shouldKnowNothingWhenRdsCannotBeAsked() {
        RdsClient failing = new RdsClient() {
            @Override
            public DescribeDbSnapshotsResponse describeDBSnapshots(DescribeDbSnapshotsRequest request) {
                throw RdsException.builder().message("AccessDenied").build();
            }

            @Override
            public String serviceName() {
                return "rds";
            }

            @Override
            public void close() {
            }
        };

        assertEquals(Optional.empty(), new RdsRestorePoints(failing, "taskfest-qa-db").oldest());
    }
}
