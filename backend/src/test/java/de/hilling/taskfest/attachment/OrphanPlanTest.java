package de.hilling.taskfest.attachment;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * What the orphan clean-up (#208) decides, from a listing and the attachment rows, without S3 or a
 * database: which objects go, which are spared and why, and which attachments lack their object.
 *
 * <p>A plain unit test, so the decision -- including the guards that keep a database restored from
 * an older snapshot, or an empty one, from wiping the bucket -- is in mutation testing's scope.</p>
 */
class OrphanPlanTest {

    private static final Instant NOW = Instant.parse("2026-10-10T12:00:00Z");
    private static final Duration MARGIN = Duration.ofDays(1);
    private static final int MAX_DELETIONS = 3;

    private static AttachmentStore.StoredObject object(String key, Duration age) {
        return new AttachmentStore.StoredObject(key, NOW.minus(age));
    }

    private static OrphanPlan.Row row(long id, String key, AttachmentState state, Duration age) {
        return new OrphanPlan.Row(id, key, state, NOW.minus(age));
    }

    private static OrphanPlan plan(List<AttachmentStore.StoredObject> objects, List<OrphanPlan.Row> rows) {
        return OrphanPlan.of(objects, rows, NOW, MARGIN, MAX_DELETIONS);
    }

    @Test
    void shouldDeleteAnObjectNoRowRefersToOnceOlderThanTheMargin() {
        OrphanPlan plan = plan(
            List.of(object("orphan", Duration.ofDays(3)), object("kept", Duration.ofDays(3))),
            List.of(row(1, "kept", AttachmentState.AVAILABLE, Duration.ofHours(1))));

        assertEquals(List.of("orphan"), plan.deletions());
        assertEquals(OrphanPlan.Hold.NONE, plan.hold());
    }

    @Test
    void shouldSpareAnObjectYoungerThanTheMargin() {
        OrphanPlan plan = plan(
            List.of(object("young", Duration.ofHours(23))),
            List.of(row(1, "other", AttachmentState.PENDING, Duration.ofMinutes(1))));

        assertTrue(plan.deletions().isEmpty());
    }

    @Test
    void shouldDeleteNothingWhenTheDatabaseHoldsNoAttachmentsAtAll() {
        // An environment brought up with an empty database, its bucket intact.
        OrphanPlan plan = plan(List.of(object("a", Duration.ofDays(30)), object("b", Duration.ofDays(30))), List.of());

        assertTrue(plan.deletions().isEmpty());
        assertEquals(OrphanPlan.Hold.NO_ATTACHMENTS, plan.hold());
    }

    @Test
    void shouldSpareObjectsNewerThanTheNewestAttachment() {
        // A database restored from an older snapshot: files written since are not orphans to it.
        OrphanPlan plan = plan(
            List.of(object("before", Duration.ofDays(10)), object("since", Duration.ofDays(3))),
            List.of(row(1, "known", AttachmentState.AVAILABLE, Duration.ofDays(5))));

        assertEquals(List.of("before"), plan.deletions());
    }

    @Test
    void shouldDeleteNoMoreThanTheLimitAndSaySo() {
        OrphanPlan plan = plan(
            List.of(object("o1", Duration.ofDays(3)), object("o2", Duration.ofDays(3)), object("o3", Duration.ofDays(3)),
                object("o4", Duration.ofDays(3))),
            List.of(row(1, "known", AttachmentState.AVAILABLE, Duration.ofHours(1))));

        assertTrue(plan.deletions().isEmpty());
        assertEquals(OrphanPlan.Hold.TOO_MANY, plan.hold());
        assertEquals(4, plan.orphans());
    }

    @Test
    void shouldDeleteExactlyTheLimit() {
        OrphanPlan plan = plan(
            List.of(object("o1", Duration.ofDays(3)), object("o2", Duration.ofDays(3)), object("o3", Duration.ofDays(3))),
            List.of(row(1, "known", AttachmentState.AVAILABLE, Duration.ofHours(1))));

        assertEquals(List.of("o1", "o2", "o3"), plan.deletions());
    }

    @Test
    void shouldNameAvailableAttachmentsWithoutTheirObjectButNotPendingOnes() {
        OrphanPlan plan = plan(
            List.of(object("present", Duration.ofDays(1))),
            List.of(
                row(1, "present", AttachmentState.AVAILABLE, Duration.ofDays(1)),
                row(2, "missing", AttachmentState.AVAILABLE, Duration.ofDays(1)),
                row(3, "not-yet", AttachmentState.PENDING, Duration.ofMinutes(5))));

        assertEquals(List.of(2L), plan.missingObjects());
    }

    @Test
    void shouldCountWhatWasListed() {
        OrphanPlan plan = plan(List.of(object("a", Duration.ZERO), object("b", Duration.ZERO)), List.of());

        assertEquals(2, plan.listed());
    }
}
