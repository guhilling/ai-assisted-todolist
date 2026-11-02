package de.hilling.taskfest.api;

import jakarta.validation.Constraint;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import jakarta.validation.Payload;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * A task's time zone comes only with a due time (#474): a zone says where a time is meant, so on
 * an all-day task it would say nothing.
 *
 * <p>On the request type rather than a component, because it relates two of them. The database's
 * {@code task_zone_only_with_time} constraint holds the same rule for anything that writes around
 * the API.</p>
 */
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = ZoneOnlyWithTime.Validator.class)
public @interface ZoneOnlyWithTime {

    /** What a refused request is told. */
    String message() default "a time zone needs a due time";

    /** Bean Validation's groups; none are used. */
    Class<?>[] groups() default {};

    /** Bean Validation's payload; none is used. */
    Class<? extends Payload>[] payload() default {};

    /** Refuses a zone without a time; everything else is for the components' own constraints. */
    final class Validator implements ConstraintValidator<ZoneOnlyWithTime, TaskResource.TaskFields> {

        @Override
        public boolean isValid(TaskResource.TaskFields value, ConstraintValidatorContext context) {
            return value == null || value.timeZone() == null || value.dueTime() != null;
        }
    }
}
