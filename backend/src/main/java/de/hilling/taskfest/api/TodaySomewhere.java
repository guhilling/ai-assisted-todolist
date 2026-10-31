package de.hilling.taskfest.api;

import jakarta.validation.Constraint;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import jakarta.validation.Payload;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import java.time.LocalDate;
import java.time.ZoneOffset;

/**
 * A date that is today, or later, somewhere: no earlier than today in UTC-12.
 *
 * <p>{@code @FutureOrPresent} judged a due date by the server's clock, UTC in the container,
 * while the website and the app take "today" in the user's zone (#425). At 21:00 in New York it
 * is already tomorrow in UTC, so a task due today was refused as past. UTC-12 is the westernmost
 * zone, so its today is the earliest date that is still today anywhere. The cost is that a user
 * ahead of it may set yesterday's date, which an update can do anyway.</p>
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

    /**
     * Checks a date against today in UTC-12, on Bean Validation's clock; a missing date is
     * {@code @NotNull}'s to refuse.
     */
    final class Validator implements ConstraintValidator<TodaySomewhere, LocalDate> {

        private static final ZoneOffset WESTERNMOST = ZoneOffset.ofHours(-12);

        @Override
        public boolean isValid(LocalDate value, ConstraintValidatorContext context) {
            return value == null || !value.isBefore(
                LocalDate.now(context.getClockProvider().getClock().withZone(WESTERNMOST)));
        }
    }
}
