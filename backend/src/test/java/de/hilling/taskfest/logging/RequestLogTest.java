package de.hilling.taskfest.logging;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.security.TestSecurity;
import io.quarkus.test.security.oidc.Claim;
import io.quarkus.test.security.oidc.OidcSecurity;
import java.util.List;
import java.util.Map;
import java.time.Duration;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.logging.Handler;
import java.util.logging.LogRecord;
import java.util.logging.Logger;
import org.jboss.logmanager.ExtLogRecord;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.awaitility.Awaitility.await;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Pins down the access line every HTTP request writes (#122): one record on the
 * {@code de.hilling.taskfest.access} logger, its fields in the MDC so CloudWatch Logs Insights
 * can query them -- including requests the security layer answers before any REST resource --
 * and nothing for the health checks the load balancer sends every few seconds.
 *
 * <p>In-JVM under the plain test profile, with identity faked by {@code @TestSecurity}: what is
 * checked is the line, not the sign-in, so no Keycloak is needed. The line is written when the
 * response has ended, after RestAssured already has it, hence the short wait.</p>
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

    /** The one access line the request wrote, once it has been written. */
    private Map<String, String> theLine() throws InterruptedException {
        await().atMost(Duration.ofSeconds(5)).until(() -> !records.isEmpty());
        assertEquals(1, records.size());
        return records.get(0);
    }

    @Test
    @TestSecurity(user = "alice")
    @OidcSecurity(claims = { @Claim(key = "email", value = "alice@example.com"), @Claim(key = "sub", value = SUBJECT) })
    void shouldWriteOneStructuredLinePerApiRequest() throws InterruptedException {
        given().when().get("/api/tasks").then().statusCode(200);

        Map<String, String> fields = theLine();
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
    void shouldTakeTheRequestIdFromTheLoadBalancer() throws InterruptedException {
        String traceId = "Root=1-67891233-abcdef012345678912345678";
        given().header(RequestLog.REQUEST_ID_HEADER, traceId).when().get("/api/tasks").then().statusCode(200);

        assertEquals(traceId, theLine().get("requestId"));
    }

    @Test
    void shouldNotTakeARequestIdThatIsNotTheLoadBalancers() throws InterruptedException {
        String forged = "x".repeat(5000);
        given().header(RequestLog.REQUEST_ID_HEADER, forged).when().get("/api/auth/providers").then().statusCode(200);

        String requestId = theLine().get("requestId");
        assertFalse(requestId.contains("xxx"));
        assertTrue(requestId.length() <= 64);
    }

    @Test
    void shouldLogARequestTheSecurityLayerTurnsAway() throws InterruptedException {
        given().header("X-Requested-With", "JavaScript").when().get("/api/tasks").then().statusCode(401);

        Map<String, String> fields = theLine();
        assertEquals("401", fields.get("status"));
        assertEquals("/api/tasks", fields.get("path"));
        assertFalse(fields.containsKey("user"));
    }

    @Test
    void shouldLogARequestNoResourceMatches() throws InterruptedException {
        given().when().get("/api/no-such-thing").then().statusCode(404);

        assertEquals("404", theLine().get("status"));
    }

    @Test
    void shouldLogAnonymousRequestsWithoutAUser() throws InterruptedException {
        given().when().get("/api/auth/providers").then().statusCode(200);

        Map<String, String> fields = theLine();
        assertFalse(fields.containsKey("user"));
        assertEquals("200", fields.get("status"));
    }

    @Test
    void shouldLeaveTheHealthChecksOut() throws InterruptedException {
        given().when().get("/q/health/ready").then().statusCode(200);
        given().when().get("/api/auth/providers").then().statusCode(200);

        // The second request is the marker: once its line is there, the first one's would be too.
        assertEquals("/api/auth/providers", theLine().get("path"));
    }
}
