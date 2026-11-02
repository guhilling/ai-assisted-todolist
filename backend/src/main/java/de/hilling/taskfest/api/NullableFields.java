package de.hilling.taskfest.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.quarkus.jackson.ObjectMapperCustomizer;
import jakarta.inject.Singleton;
import org.openapitools.jackson.nullable.JsonNullableModule;

/**
 * Lets a request tell a field it leaves out from one it sends as {@code null} (#497), through
 * {@link org.openapitools.jackson.nullable.JsonNullable}.
 *
 * <p>Quarkus does not register Jackson modules it finds on the class path, so this does.</p>
 */
@Singleton
public class NullableFields implements ObjectMapperCustomizer {

    @Override
    public void customize(ObjectMapper mapper) {
        mapper.registerModule(new JsonNullableModule());
    }
}
