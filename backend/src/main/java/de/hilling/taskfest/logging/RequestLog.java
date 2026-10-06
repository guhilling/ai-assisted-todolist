package de.hilling.taskfest.logging;

import io.quarkus.security.identity.SecurityIdentity;
import jakarta.inject.Inject;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerResponseContext;
import java.security.Principal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.eclipse.microprofile.jwt.JsonWebToken;
import org.jboss.resteasy.reactive.server.ServerRequestFilter;
import org.jboss.resteasy.reactive.server.ServerResponseFilter;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;

/**
 * Writes one structured line per API request, so CloudWatch Logs Insights can answer what failed
 * and what was slow (#122).
 *
 * <p>The fields go into the MDC rather than the message, because the JSON log format writes the
 * MDC as an object of its own: a query filters on {@code mdc.status} instead of parsing text. The
 * request id is set when the request arrives and stays for its whole length, so every other line
 * the request causes carries it too. It is the load balancer's {@code X-Amzn-Trace-Id} where there
 * is one -- the same id CloudFront and the ALB log -- and a fresh UUID locally.</p>
 *
 * <p>The user is the token's {@code sub}, a pseudonymous id, and never the email address:
 * {@code doc/deployment/observability.md} lists what personal data the logs hold. The health and
 * metrics endpoints under {@code /q} are not REST resources and never reach these filters, which
 * is what keeps the load balancer's checks out of the log.</p>
 */
public class RequestLog {

    /** The logger the access lines go to, so they can be filtered, silenced or captured on their own. */
    public static final String LOGGER = "de.hilling.taskfest.access";

    static final String REQUEST_ID_HEADER = "X-Amzn-Trace-Id";

    private static final String STARTED = RequestLog.class.getName() + ".started";
    private static final List<String> FIELDS = List.of("method", "path", "status", "durationMs", "user");
    private static final Logger LOG = LoggerFactory.getLogger(LOGGER);

    @Inject
    SecurityIdentity identity;

    /** Notes when the request arrived, and puts its id in the MDC for everything logged during it. */
    @ServerRequestFilter(preMatching = true)
    public void start(ContainerRequestContext request) {
        request.setProperty(STARTED, Instant.now());
        String id = request.getHeaderString(REQUEST_ID_HEADER);
        MDC.put("requestId", id == null || id.isBlank() ? UUID.randomUUID().toString() : id);
    }

    /** Writes the access line once the response is known, then clears the MDC for the next request. */
    @ServerResponseFilter
    public void finish(ContainerRequestContext request, ContainerResponseContext response) {
        try {
            Instant started = (Instant) request.getProperty(STARTED);
            long millis = started == null ? -1 : Duration.between(started, Instant.now()).toMillis();
            String method = request.getMethod();
            String path = request.getUriInfo().getRequestUri().getRawPath();
            MDC.put("method", method);
            MDC.put("path", path);
            MDC.put("status", String.valueOf(response.getStatus()));
            MDC.put("durationMs", String.valueOf(millis));
            if (!identity.isAnonymous()) {
                MDC.put("user", subject(identity.getPrincipal()));
            }
            LOG.info("{} {} {} {} ms", method, path, response.getStatus(), millis);
        } finally {
            FIELDS.forEach(MDC::remove);
            MDC.remove("requestId");
        }
    }

    /** The pseudonymous id of a user: the token's {@code sub} where there is a token, else the name. */
    static String subject(Principal principal) {
        if (principal instanceof JsonWebToken token && token.getSubject() != null) {
            return token.getSubject();
        }
        return principal.getName();
    }
}
