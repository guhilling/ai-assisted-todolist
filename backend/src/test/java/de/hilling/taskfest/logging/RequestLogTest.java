package de.hilling.taskfest.logging;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.security.TestSecurity;
import io.quarkus.test.security.oidc.Claim;
import io.quarkus.test.security.oidc.OidcSecurity;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.logging.Handler;
import java.util.logging.LogRecord;
import java.util.logging.Logger;
import org.jboss.logmanager.ExtLogRecord;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Pins down the access line every API request writes (#122): one record on the
 * {@code de.hilling.taskfest.access} logger, its fields in the MDC so CloudWatch Logs Insights
 * can query them, and nothing for the health checks the load balancer sends every few seconds.
 *
 * <p>In-JVM under the plain test profile, with identity faked by {@code @TestSecurity}: what is
 * checked is the line, not the sign-in, so no Keycloak is needed.</p>
 */
@QuarkusTest
class RequestLogTest {

    private static final String SUBJECT = "google-subject-1234";

    /** The MDC of each access line, copied while it is logged: the record reads it lazily otherwise. */
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
    void captureAccessLines() {
        Logger.getLogger(RequestLog.LOGGER).addHandler(capture);
    }

    @AfterEach
    void stopCapturing() {
        Logger.getLogger(RequestLog.LOGGER).removeHandler(capture);
    }

    @Test
    @TestSecurity(user = "alice")
    @OidcSecurity(claims = { @Claim(key = "email", value = "alice@example.com"), @Claim(key = "sub", value = SUBJECT) })
    void shouldWriteOneStructuredLinePerApiRequest() {
        given().when().get("/api/tasks").then().statusCode(200);

        assertEquals(1, records.size());
        Map<String, String> fields = records.get(0);
        assertEquals("GET", fields.get("method"));
        assertEquals("/api/tasks", fields.get("path"));
        assertEquals("200", fields.get("status"));
        assertEquals(SUBJECT, fields.get("user"));
        assertFalse(fields.getOrDefault("requestId", "").isBlank());
        assertTrue(Long.parseLong(fields.get("durationMs")) >= 0);
    }

    @Test
    @TestSecurity(user = "alice")
    @OidcSecurity(claims = { @Claim(key = "email", value = "alice@example.com"), @Claim(key = "sub", value = SUBJECT) })
    void shouldTakeTheRequestIdFromTheLoadBalancer() {
        given().header("X-Amzn-Trace-Id", "Root=1-abc-def").when().get("/api/tasks").then().statusCode(200);

        assertEquals("Root=1-abc-def", records.get(0).get("requestId"));
    }

    @Test
    void shouldLogAnonymousRequestsWithoutAUser() {
        given().when().get("/api/auth/providers").then().statusCode(200);

        assertEquals(1, records.size());
        assertFalse(records.get(0).containsKey("user"));
        assertEquals("200", records.get(0).get("status"));
    }

    @Test
    void shouldLeaveTheHealthChecksOut() {
        given().when().get("/q/health/ready").then().statusCode(200);

        assertTrue(records.isEmpty());
    }
}
