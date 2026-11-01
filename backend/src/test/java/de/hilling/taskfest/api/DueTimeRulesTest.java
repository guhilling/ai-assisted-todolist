package de.hilling.taskfest.api;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.is;

import de.hilling.taskfest.model.TaskImportance;
import de.hilling.taskfest.model.TaskState;
import jakarta.validation.Validation;
import jakarta.validation.ValidatorFactory;
import java.time.LocalDate;
import java.time.LocalTime;
import org.hibernate.validator.messageinterpolation.ParameterMessageInterpolator;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Which due times and zones a task request lets through (#474): a zone only with a time, and only
 * one the JVM knows by name.
 *
 * <p>A plain unit test of the constraints on the request records, without Quarkus; the HTTP side,
 * that a refusal is a 400, is {@link DueTimeTest}'s.</p>
 */
class DueTimeRulesTest {

    private static final LocalDate DATE = LocalDate.parse("2099-11-30");
    private static final LocalTime TEN = LocalTime.parse("10:00");

    private static ValidatorFactory factory;

    @BeforeAll
    static void startValidation() {
        factory = Validation.byDefaultProvider().configure()
            .messageInterpolator(new ParameterMessageInterpolator())
            .buildValidatorFactory();
    }

    @AfterAll
    static void stopValidation() {
        factory.close();
    }

    private static int violations(Object bean) {
        return factory.getValidator().validate(bean).size();
    }

    private static TaskResource.TaskCreateRequest create(LocalTime time, String zone) {
        return new TaskResource.TaskCreateRequest(
            "Call the office", DATE, time, zone, TaskImportance.MEDIUM, TaskState.TODO, null);
    }

    private static TaskResource.TaskUpdateRequest update(LocalTime time, String zone) {
        return new TaskResource.TaskUpdateRequest(
            "Call the office", DATE, time, zone, TaskImportance.MEDIUM, TaskState.TODO);
    }

    @Test
    void shouldAcceptAnAllDayTask() {
        assertThat(violations(create(null, null)), is(0));
    }

    @Test
    void shouldAcceptAFloatingTime() {
        assertThat(violations(create(TEN, null)), is(0));
    }

    @Test
    void shouldAcceptAZonedTime() {
        assertThat(violations(create(TEN, "Europe/Berlin")), is(0));
        assertThat(violations(update(TEN, "America/New_York")), is(0));
    }

    @Test
    void shouldRefuseAZoneWithoutATimeOnCreate() {
        assertThat(violations(create(null, "Europe/Berlin")), is(1));
    }

    @Test
    void shouldRefuseAZoneWithoutATimeOnUpdate() {
        assertThat(violations(update(null, "Europe/Berlin")), is(1));
    }

    @Test
    void shouldRefuseAZoneTheJvmDoesNotKnow() {
        assertThat(violations(create(TEN, "Europe/Atlantis")), is(1));
        assertThat(violations(update(TEN, "Europe/Atlantis")), is(1));
    }

    @Test
    void shouldRefuseAZoneNamedInTheWrongCase() {
        assertThat(violations(create(TEN, "europe/berlin")), is(1));
    }

    @Test
    void shouldRefuseABareOffset() {
        // An offset is not a zone: +02:00 is Berlin's in summer only, and a task would come out an
        // hour wrong for half the year.
        assertThat(violations(create(TEN, "+02:00")), is(1));
    }

    @Test
    void shouldRefuseAnOffsetUnderAZonesName() {
        // The same offset by a name the JVM knows: Etc/GMT-2 is +02:00 all year, EST never EDT.
        assertThat(violations(create(TEN, "Etc/GMT-2")), is(1));
        assertThat(violations(create(TEN, "EST")), is(1));
    }

    @Test
    void shouldAcceptUtc() {
        // A fixed offset too, but one that is meant as itself, with no summer time to miss.
        assertThat(violations(create(TEN, "UTC")), is(0));
        assertThat(violations(create(TEN, "Etc/UTC")), is(0));
    }
}
