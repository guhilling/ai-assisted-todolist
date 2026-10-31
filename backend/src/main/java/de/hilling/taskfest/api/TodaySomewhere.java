package de.hilling.taskfest.api;

import jakarta.validation.Constraint;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import jakarta.validation.Payload;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneOffset;

/**
 * A date that is today, or later, somewhere: no earlier than yesterday in UTC.
 *
 * <p>{@code @FutureOrPresent} judged a due date by the server's clock, UTC in the container,
 * while the website and the app take "today" in the user's zone (#425). At 21:00 in New York it
 * is already tomorrow in UTC, so a task due today was refused as past. No zone is more than a day
 * behind UTC, so yesterday in UTC is someone's today. The cost is that a user ahead of UTC may set
 * yesterday's date, which an update can do anyway.</p>
 */
@Target({ ElementType.FIELD, ElementType.PARAMETER, ElementType.RECORD_COMPONENT })
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = TodaySomewhere.Validator.class)
public @interface TodaySomewhere {

    /** What a refused date is told. */
    String message() default "must be today or later";

    /** Bean Validation's groups; none are used. */
    Class<?>[] groups() default {};

    /** Bean Validation's payload; none is used. */
    Class<? extends Payload>[] payload() default {};

    /** Checks a date against yesterday in UTC; a missing date is {@code @NotNull}'s to refuse. */
    final class Validator implements ConstraintValidator<TodaySomewhere, LocalDate> {

        private final Clock clock = Clock.system(ZoneOffset.UTC);

        @Override
        public boolean isValid(LocalDate value, ConstraintValidatorContext context) {
            return value == null || !value.isBefore(LocalDate.now(clock).minusDays(1));
        }
    }
}
