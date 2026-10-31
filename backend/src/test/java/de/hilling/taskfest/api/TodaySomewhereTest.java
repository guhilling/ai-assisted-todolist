package de.hilling.taskfest.api;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.is;

import java.time.LocalDate;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;

/** Which due dates {@link TodaySomewhere} lets through (#425). */
class TodaySomewhereTest {

    private final TodaySomewhere.Validator validator = new TodaySomewhere.Validator();

    private final LocalDate todayInUtc = LocalDate.now(ZoneOffset.UTC);

    @Test
    void shouldAcceptYesterdayInUtcWhichIsStillTodayBehindIt() {
        assertThat(validator.isValid(todayInUtc.minusDays(1), null), is(true));
    }

    @Test
    void shouldRefuseTheDayBefore() {
        assertThat(validator.isValid(todayInUtc.minusDays(2), null), is(false));
    }

    @Test
    void shouldLeaveAMissingDateToNotNull() {
        assertThat(validator.isValid(null, null), is(true));
    }
}
