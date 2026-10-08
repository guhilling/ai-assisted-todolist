package de.hilling.taskfest.attachment;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * What the orphan clean-up (#208) decides, from a listing and the attachment rows, without S3 or a
 * database: which objects go, how many orphans there are, and which attachments lack their object.
 *
 * <p>A plain unit test, so the decision -- including the guard that keeps an empty database from
 * wiping the bucket -- is in mutation testing's scope.</p>
 */
class OrphanPlanTest {

    private static final Instant NOW = Instant.parse("2026-10-10T12:00:00Z");
    private static final Duration MARGIN = Duration.ofDays(7);

    private static AttachmentStore.StoredObject object(String key, Duration age) {
        return new AttachmentStore.StoredObject(key, NOW.minus(age));
    }

    private static OrphanPlan.Row row(long id, String key, AttachmentState state) {
        return new OrphanPlan.Row(id, key, state, NOW);
    }

    private static OrphanPlan plan(List<AttachmentStore.StoredObject> objects, List<OrphanPlan.Row> rows) {
        return OrphanPlan.of(objects, rows, NOW, MARGIN);
    }

    @Test
    void shouldDeleteAnObjectNoRowRefersToOnceOlderThanTheMargin() {
        OrphanPlan plan = plan(
            List.of(object("orphan", Duration.ofDays(8)), object("kept", Duration.ofDays(8))),
            List.of(row(1, "kept", AttachmentState.AVAILABLE)));

        assertEquals(List.of("orphan"), plan.deletions());
        assertEquals(1, plan.orphans());
        assertEquals(OrphanPlan.Hold.NONE, plan.hold());
    }

    @Test
    void shouldSpareButCountAnOrphanYoungerThanTheMargin() {
        // Counted, so the alert sees it from the first hour rather than after seven days.
        OrphanPlan plan = plan(
            List.of(object("young", Duration.ofDays(6))),
            List.of(row(1, "other", AttachmentState.AVAILABLE)));

        assertTrue(plan.deletions().isEmpty());
        assertEquals(1, plan.orphans());
    }

    @Test
    void shouldDeleteEveryOrphanHoweverMany() {
        List<AttachmentStore.StoredObject> objects = IntStream.range(0, 500)
            .mapToObj(index -> object("o" + index, Duration.ofDays(8)))
            .toList();

        OrphanPlan plan = plan(objects, List.of(row(1, "known", AttachmentState.AVAILABLE)));

        assertEquals(500, plan.deletions().size());
    }

    @Test
    void shouldDeleteNothingButCountEverythingWhenTheDatabaseHoldsNoAttachments() {
        // An environment brought up with an empty database, its bucket intact: nothing goes, and
        // every object counts as an orphan, so the alert says something is wrong.
        OrphanPlan plan = plan(List.of(object("a", Duration.ofDays(30)), object("b", Duration.ofDays(30))), List.of());

        assertTrue(plan.deletions().isEmpty());
        assertEquals(2, plan.orphans());
        assertEquals(OrphanPlan.Hold.NO_ATTACHMENTS, plan.hold());
    }

    @Test
    void shouldNameAvailableAttachmentsWithoutTheirObjectButNotPendingOnes() {
        OrphanPlan plan = plan(
            List.of(object("present", Duration.ofDays(1))),
            List.of(
                row(1, "present", AttachmentState.AVAILABLE),
                row(2, "missing", AttachmentState.AVAILABLE),
                row(3, "not-yet", AttachmentState.PENDING)));

        assertEquals(List.of(2L), plan.missingObjects());
    }

    @Test
    void shouldCountWhatWasListed() {
        OrphanPlan plan = plan(List.of(object("a", Duration.ZERO), object("b", Duration.ZERO)), List.of());

        assertEquals(2, plan.listed());
    }
}
