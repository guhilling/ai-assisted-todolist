package de.hilling.taskfest.api;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.is;

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
