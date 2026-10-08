package de.hilling.taskfest.account;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Which deletion records (#213) may go: those older than the oldest point the database could be
 * restored to, because no restore can bring their account back any more (Gunnar's decision). When
 * that point is unknown, none may.
 */
class DeletionPruningTest {

    private static final Instant OLDEST = Instant.parse("2026-10-01T00:00:00Z");

    private static DeletionRecords.Deletion deletion(String hash, String at) {
        return new DeletionRecords.Deletion(hash, Instant.parse(at));
    }

    @Test
    void shouldPruneOnlyRecordsOlderThanTheOldestRestorablePoint() {
        List<DeletionRecords.Deletion> records = List.of(
            deletion("before", "2026-09-30T23:59:59Z"),
            deletion("at", "2026-10-01T00:00:00Z"),
            deletion("after", "2026-10-05T00:00:00Z"));

        assertEquals(List.of("before"), DeletionRecords.prunable(records, Optional.of(OLDEST), Set.of()).stream()
            .map(DeletionRecords.Deletion::emailHash).toList());
    }

    @Test
    void shouldKeepTheRecordOfAnAccountThatIsStillThere() {
        // Its re-deletion failed; pruning the record would make the failure permanent.
        List<DeletionRecords.Deletion> records = List.of(deletion("failed", "2026-09-01T00:00:00Z"));

        assertTrue(DeletionRecords.prunable(records, Optional.of(OLDEST), Set.of("failed")).isEmpty());
    }

    @Test
    void shouldPruneNothingWhenTheOldestRestorablePointIsUnknown() {
        List<DeletionRecords.Deletion> records = List.of(deletion("old", "2020-01-01T00:00:00Z"));

        assertTrue(DeletionRecords.prunable(records, Optional.empty(), Set.of()).isEmpty());
    }
}
