package de.hilling.taskfest.api;

import jakarta.validation.Constraint;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import jakarta.validation.Payload;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import java.time.ZoneId;
import java.time.zone.ZoneRulesProvider;
import java.util.Set;

/**
 * A time zone the JVM knows by its IANA name, such as {@code Europe/Berlin} (#474).
 *
 * <p>The name must be one of the JVM's zones, exactly as written. That is narrower than
 * {@link ZoneId#of}, which also takes an offset such as {@code +02:00}: an offset is not a zone,
 * and a task given Berlin's summer offset would come out an hour wrong all winter. For the same
 * reason a zone that is a fixed offset by name is refused too -- {@code Etc/GMT-2} is +02:00 all
 * year, {@code EST} never EDT -- except UTC and GMT, which are meant as themselves.</p>
 */
@Target({ ElementType.FIELD, ElementType.PARAMETER, ElementType.RECORD_COMPONENT })
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = KnownTimeZone.Validator.class)
public @interface KnownTimeZone {

    /** What a refused zone is told. */
    String message() default "must be a time zone such as Europe/Berlin";

    /** Bean Validation's groups; none are used. */
    Class<?>[] groups() default {};

    /** Bean Validation's payload; none is used. */
    Class<? extends Payload>[] payload() default {};

    /** Looks the name up among the JVM's zones; a missing zone is a floating time, and valid. */
    final class Validator implements ConstraintValidator<KnownTimeZone, String> {

        /** The fixed offsets that are meant as themselves: UTC, and GMT, the same in practice. */
        private static final Set<String> UTC = Set.of("UTC", "Etc/UTC", "GMT", "Etc/GMT");

        @Override
        public boolean isValid(String value, ConstraintValidatorContext context) {
            if (value == null) {
                return true;
            }
            // The provider's own set, not ZoneId's, which copies all six hundred names on every call.
            return ZoneRulesProvider.getAvailableZoneIds().contains(value)
                && (UTC.contains(value) || !ZoneId.of(value).getRules().isFixedOffset());
        }
    }
}
