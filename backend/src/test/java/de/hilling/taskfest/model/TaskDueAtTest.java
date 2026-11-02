package de.hilling.taskfest.model;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.equalTo;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/**
 * Which moment a task is due at (#474): one for a zoned task only, worked out as
 * {@code ZonedDateTime.of} does, so a time in a daylight-saving gap moves later and one in an
 * overlap takes the earlier of its two moments, as RFC 5545 and Temporal do.
 *
 * <p>A plain unit test: the rule is arithmetic on the entity's fields, and needs neither Quarkus
 * nor a database. 2027's changes in Berlin are on 28 March (02:00 becomes 03:00) and on
 * 31 October (03:00 becomes 02:00).</p>
 */
class TaskDueAtTest {

    private static final String BERLIN = "Europe/Berlin";

    private static Task due(String date, String time, String zone) {
        Task task = new Task();
        task.dueDate = LocalDate.parse(date);
        task.dueTime = time == null ? null : LocalTime.parse(time);
        task.timeZone = zone;
        return task;
    }

    @Test
    void shouldHaveNoMomentForAnAllDayTask() {
        assertThat(due("2026-11-30", null, null).dueAt(), equalTo(Optional.empty()));
    }

    @Test
    void shouldHaveNoMomentForAFloatingTime() {
        // It follows whoever reads it, so there is no one moment to name.
        assertThat(due("2026-11-30", "08:00", null).dueAt(), equalTo(Optional.empty()));
    }

    @Test
    void shouldBeTheMomentOfAZonedTime() {
        assertThat(due("2026-11-30", "10:00", BERLIN).dueAt(),
            equalTo(Optional.of(Instant.parse("2026-11-30T09:00:00Z"))));
    }

    @Test
    void shouldMoveATimeInTheSpringGapLater() {
        // 02:30 does not exist that night; it is read with the offset from before the gap.
        assertThat(due("2027-03-28", "02:30", BERLIN).dueAt(),
            equalTo(Optional.of(Instant.parse("2027-03-28T01:30:00Z"))));
    }

    @Test
    void shouldTakeTheEarlierMomentOfATimeInTheAutumnOverlap() {
        // 02:30 happens twice that night, at +02:00 and again at +01:00.
        assertThat(due("2027-10-31", "02:30", BERLIN).dueAt(),
            equalTo(Optional.of(Instant.parse("2027-10-31T00:30:00Z"))));
    }

    @Test
    void shouldHaveNoMomentForAZoneThisJvmDoesNotKnow() {
        // Stored by a JVM with newer tzdata, or around the API: the task still shows, without one.
        assertThat(due("2026-11-30", "10:00", "Mars/Olympus_Mons").dueAt(), equalTo(Optional.empty()));
    }
}
