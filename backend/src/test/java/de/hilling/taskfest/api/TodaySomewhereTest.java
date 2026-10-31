package de.hilling.taskfest.api;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.is;

import de.hilling.taskfest.model.TaskImportance;
import de.hilling.taskfest.model.TaskState;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import org.hibernate.validator.messageinterpolation.ParameterMessageInterpolator;
import org.junit.jupiter.api.Test;

/** Which due dates {@link TodaySomewhere} lets through (#425), on a clock that stands still. */
class TodaySomewhereTest {

    /** A date to validate; the constraint only applies to a field. */
    record Due(@TodaySomewhere LocalDate date) {
    }

    @Test
    void shouldAcceptUtcsYesterdayWhileItIsStillTodayInUtcMinusTwelve() {
        assertThat(validAt("2026-10-31T11:59:59Z", "2026-10-30"), is(true));
    }

    @Test
    void shouldRefuseUtcsYesterdayOnceItIsTodayNowhere() {
        assertThat(validAt("2026-10-31T12:00:00Z", "2026-10-30"), is(false));
    }

    @Test
    void shouldRefuseTheDayBeforeUtcMinusTwelvesToday() {
        assertThat(validAt("2026-10-31T11:59:59Z", "2026-10-29"), is(false));
    }

    @Test
    void shouldLeaveAMissingDateToNotNull() {
        assertThat(validAt("2026-10-31T12:00:00Z", null), is(true));
    }

    /**
     * The rule a new task's due date is held to, not the old {@code @FutureOrPresent}: the HTTP
     * test can tell the two apart only before 12:00 UTC, this one always (CodeRabbit on #450).
     */
    @Test
    void shouldHoldANewTasksDueDateToTodaySomewhere() {
        var request = new TaskResource.TaskCreateRequest(
            "Renew the passport", LocalDate.parse("2026-10-30"), TaskImportance.HIGH, TaskState.TODO, null);

        assertThat(violationsAt("2026-10-31T06:00:00Z", request), is(0));
    }

    private static int violationsAt(String instant, Object bean) {
        Clock clock = Clock.fixed(Instant.parse(instant), ZoneOffset.UTC);
        try (var factory = Validation.byDefaultProvider().configure()
                .clockProvider(() -> clock)
                .messageInterpolator(new ParameterMessageInterpolator())
                .buildValidatorFactory()) {
            return factory.getValidator().validate(bean).size();
        }
    }

    private static boolean validAt(String instant, String date) {
        Clock clock = Clock.fixed(Instant.parse(instant), ZoneOffset.UTC);
        try (var factory = Validation.byDefaultProvider().configure()
                .clockProvider(() -> clock)
                .messageInterpolator(new ParameterMessageInterpolator())
                .buildValidatorFactory()) {
            Validator validator = factory.getValidator();
            return validator.validate(new Due(date == null ? null : LocalDate.parse(date))).isEmpty();
        }
    }
}
