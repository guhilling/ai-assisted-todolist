package de.hilling.taskfest.api;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.deser.std.StdDeserializer;
import java.io.IOException;
import java.time.LocalTime;
import java.util.regex.Pattern;

/**
 * Reads a due time (#474) only as the text the schema publishes: hours and minutes, {@code 00:00}
 * to {@code 23:59}.
 *
 * <p>Jackson's own reader for {@link LocalTime} also takes an array such as {@code [10, 0, 30]},
 * seconds and all, whatever {@code @JsonFormat} says, and its lenient parse takes {@code 24:00} as
 * the next day's midnight, which a {@code LocalTime} turns into this day's. Anything else is
 * refused as a request the backend cannot read, with a 400.</p>
 */
public final class DueTimeDeserializer extends StdDeserializer<LocalTime> {

    /** A due time as text, for this reader and for the published schema alike. */
    static final String PATTERN = "^([01][0-9]|2[0-3]):[0-5][0-9]$";

    private static final Pattern TIME = Pattern.compile(PATTERN);

    /** For Jackson, which makes one per property it is named on. */
    public DueTimeDeserializer() {
        super(LocalTime.class);
    }

    @Override
    public LocalTime deserialize(JsonParser parser, DeserializationContext context) throws IOException {
        if (parser.currentToken() != JsonToken.VALUE_STRING) {
            return (LocalTime) context.handleUnexpectedToken(LocalTime.class, parser);
        }
        String text = parser.getText();
        if (!TIME.matcher(text).matches()) {
            return (LocalTime) context.handleWeirdStringValue(LocalTime.class, text, "a due time is HH:mm");
        }
        return LocalTime.parse(text);
    }
}
