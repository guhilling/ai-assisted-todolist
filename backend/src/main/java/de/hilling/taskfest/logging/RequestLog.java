package de.hilling.taskfest.logging;

import io.quarkus.security.identity.SecurityIdentity;
import io.quarkus.vertx.http.runtime.RouteConstants;
import io.quarkus.vertx.http.runtime.security.QuarkusHttpUser;
import io.vertx.ext.web.Router;
import io.vertx.ext.web.RoutingContext;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import java.security.Principal;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.eclipse.microprofile.jwt.JsonWebToken;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;

/**
 * Writes one structured line per HTTP request, so CloudWatch Logs Insights can answer what failed
 * and what was slow (#122).
 *
 * <p>It sits at the very front of the HTTP router, ahead of the security handlers, rather than
 * among the REST filters: Quarkus OIDC answers some requests itself -- an expired session with a
 * 401, the sign-in redirects, the callback -- and those never reach a REST resource. Here every
 * request gets its line once the response has ended, with the status the client actually saw.
 * Only {@code /q/*} is left out, so the load balancer's health checks stay out of the log.</p>
 *
 * <p>The fields go into the MDC rather than the message, because the JSON log format writes the
 * MDC as an object of its own: a query filters on {@code mdc.status} instead of parsing text. The
 * request id is the {@code Root} of the load balancer's {@code X-Amzn-Trace-Id} where there is
 * one, and a fresh UUID otherwise -- a header that does not look like the load balancer's is not
 * trusted, since a client could send anything. The user is the token's {@code sub}, a
 * pseudonymous id, never the email address; {@code doc/deployment/observability.md} lists what
 * personal data the logs hold.</p>
 */
@ApplicationScoped
public class RequestLog {

    /** The logger the access lines go to, so they can be filtered, silenced or captured on their own. */
    public static final String LOGGER = "de.hilling.taskfest.access";

    /** The header the load balancer puts its trace id in. */
    public static final String REQUEST_ID_HEADER = "X-Amzn-Trace-Id";

    private static final Pattern TRACE_ROOT = Pattern.compile("Root=1-[0-9a-f]{8}-[0-9a-f]{24}");
    /** Longer than any header the load balancer sends; anything longer is not searched at all. */
    private static final int MAX_TRACE_HEADER = 512;
    private static final Logger LOG = LoggerFactory.getLogger(LOGGER);

    void register(@Observes Router router) {
        router.route().order(RouteConstants.ROUTE_ORDER_ACCESS_LOG_HANDLER).handler(this::handle);
    }

    void handle(RoutingContext context) {
        String path = context.request().path();
        if (path.startsWith("/q/")) {
            context.next();
            return;
        }
        Instant started = Instant.now();
        String requestId = requestId(context.request().getHeader(REQUEST_ID_HEADER));
        MDC.put("requestId", requestId);
        context.addEndHandler(ended -> write(context, path, requestId, started));
        context.next();
    }

    private static void write(RoutingContext context, String path, String requestId, Instant started) {
        Map<String, String> fields = new LinkedHashMap<>();
        fields.put("requestId", requestId);
        fields.put("method", context.request().method().name());
        fields.put("path", path);
        fields.put("status", String.valueOf(context.response().getStatusCode()));
        fields.put("durationMs", String.valueOf(Duration.between(started, Instant.now()).toMillis()));
        if (context.user() instanceof QuarkusHttpUser user) {
            SecurityIdentity identity = user.getSecurityIdentity();
            if (identity != null && !identity.isAnonymous()) {
                fields.put("user", subject(identity.getPrincipal()));
            }
        }
        fields.forEach(MDC::put);
        try {
            LOG.info("{} {} {} {} ms", fields.get("method"), path, fields.get("status"), fields.get("durationMs"));
        } finally {
            fields.keySet().forEach(MDC::remove);
        }
    }

    /** The load balancer's trace root from the header, or a fresh UUID if there is no such thing in it. */
    static String requestId(String header) {
        if (header != null && header.length() <= MAX_TRACE_HEADER) {
            Matcher root = TRACE_ROOT.matcher(header);
            if (root.find()) {
                return root.group();
            }
        }
        return UUID.randomUUID().toString();
    }

    /** The pseudonymous id of a user: the token's {@code sub}, else the principal's name, else "unknown". */
    static String subject(Principal principal) {
        if (principal instanceof JsonWebToken token && token.getSubject() != null) {
            return token.getSubject();
        }
        return principal == null || principal.getName() == null ? "unknown" : principal.getName();
    }
}
