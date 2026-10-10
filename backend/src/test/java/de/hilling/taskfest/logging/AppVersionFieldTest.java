package de.hilling.taskfest.logging;

import java.util.Optional;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Which values of the app's {@code X-TaskFest-App} header reach the access log (#268).
 *
 * <p>A plain unit test. The header says which release of the mobile app sent a request, so the logs
 * can tell who still calls an old API; it comes from the client, so only something shaped like a
 * version is written -- never a line break, never anything long.</p>
 */
class AppVersionFieldTest {

    @Test
    void shouldKeepARelease() {
        assertEquals(Optional.of("1.4.0"), RequestLog.appVersion("1.4.0"));
    }

    @Test
    void shouldKeepADevelopmentBuild() {
        assertEquals(Optional.of("0.0.0"), RequestLog.appVersion("0.0.0"));
    }

    @Test
    void shouldHaveNothingWithoutTheHeader() {
        assertEquals(Optional.empty(), RequestLog.appVersion(null));
    }

    @Test
    void shouldDropAnythingThatIsNotAVersion() {
        assertEquals(Optional.empty(), RequestLog.appVersion("1.4.0\n{\"status\":\"200\"}"));
        assertEquals(Optional.empty(), RequestLog.appVersion("latest"));
        assertEquals(Optional.empty(), RequestLog.appVersion("1.4"));
        assertEquals(Optional.empty(), RequestLog.appVersion("1".repeat(20) + ".0.0"));
    }
}
