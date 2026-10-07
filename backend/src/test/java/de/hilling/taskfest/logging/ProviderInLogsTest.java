package de.hilling.taskfest.logging;

import de.hilling.taskfest.support.KeycloakLoginFlow;
import de.hilling.taskfest.support.TwoSignInProviders;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import java.math.BigInteger;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.logging.Handler;
import java.util.logging.LogRecord;
import java.util.logging.Logger;
import org.jboss.logmanager.ExtLogRecord;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Pins down that the sign-in and access lines name the provider (#143).
 *
 * <p>With more than one provider live, a user's {@code sub} is unique only within the provider
 * that issued it, so a line naming the user without the provider is ambiguous. Real sign-ins
 * through both of {@link TwoSignInProviders}' providers -- the profile the sign-in tests use, so the
 * same Quarkus instance -- because the provider is what Quarkus OIDC recorded on the identity, which no faked
 * identity carries.</p>
 */
@QuarkusTest
@TestProfile(TwoSignInProviders.class)
class ProviderInLogsTest {

    /** The MDC of each captured line, copied while it is logged: the record reads it lazily otherwise. */
    private final List<Map<String, String>> records = new CopyOnWriteArrayList<>();
    private final Handler capture = new Handler() {
        @Override
        public void publish(LogRecord logRecord) {
            records.add(((ExtLogRecord) logRecord).getMdcCopy());
        }

        @Override
        public void flush() {
            // nothing buffered
        }

        @Override
        public void close() {
            // nothing to release
        }
    };

    @BeforeEach
    void captureLines() {
        Logger.getLogger(SignInLog.LOGGER).addHandler(capture);
        Logger.getLogger(RequestLog.LOGGER).addHandler(capture);
    }

    @AfterEach
    void stopCapturing() {
        Logger.getLogger(SignInLog.LOGGER).removeHandler(capture);
        Logger.getLogger(RequestLog.LOGGER).removeHandler(capture);
    }

    @Test
    void shouldNameTheSecondProviderOnTheSignInAndAccessLines() throws InterruptedException {
        KeycloakLoginFlow ola = new KeycloakLoginFlow();
        ola.signIn(TwoSignInProviders.OTHER_LOGIN, "ola", "ola");
        // A trace id of its own, so the access line found is this request's and not a straggler
        // from an earlier test in the same Quarkus instance.
        String root = "1-" + "%08x".formatted(new Random().nextInt()) + "-" + "%024x".formatted(new BigInteger(96, new Random()));
        ola.authenticated()
            .header("X-Requested-With", "JavaScript")
            .header(RequestLog.REQUEST_ID_HEADER, "Root=" + root)
            .when().get("/api/auth/me");

        assertEquals("other", line(fields -> "signed-in".equals(fields.get("event"))).get("provider"));
        assertEquals("other", line(fields -> ("Root=" + root).equals(fields.get("requestId"))).get("provider"));
    }

    @Test
    void shouldNameTheMainProviderByItsId() throws InterruptedException {
        // The id the provider list knows it by, not Quarkus' name for its default tenant.
        KeycloakLoginFlow gunnar = new KeycloakLoginFlow();
        gunnar.signIn("gunnar", "gunnar");

        assertEquals("keycloak", line(fields -> "signed-in".equals(fields.get("event"))).get("provider"));
    }

    /** The first captured line matching, once it has been written: access lines come after the response. */
    private Map<String, String> line(java.util.function.Predicate<Map<String, String>> matching)
        throws InterruptedException {
        Instant deadline = Instant.now().plus(Duration.ofSeconds(5));
        while (Instant.now().isBefore(deadline)) {
            for (Map<String, String> fields : records) {
                if (matching.test(fields)) {
                    return fields;
                }
            }
            Thread.sleep(20);
        }
        throw new AssertionError("no such line among " + records);
    }
}
