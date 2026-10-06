package de.hilling.taskfest.logging;

import io.quarkus.oidc.SecurityEvent;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import java.util.Map;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;

/**
 * Logs who signed in and out, so "who signed in" has an answer in CloudWatch (#122).
 *
 * <p>Quarkus OIDC fires a {@link SecurityEvent} at the end of the authorization code flow and on
 * sign-out; nothing else in the application sees those moments, since the redirects never reach a
 * REST resource. The line carries the event and the user's pseudonymous {@code sub} -- never the
 * email address, which is the decision {@code doc/deployment/observability.md} records.</p>
 */
@ApplicationScoped
public class SignInLog {

    private static final Logger LOG = LoggerFactory.getLogger("de.hilling.taskfest.auth");

    void log(@Observes SecurityEvent event) {
        fields(event).ifPresent(fields -> {
            fields.forEach(MDC::put);
            try {
                LOG.info("{} {}", fields.get("event"), fields.get("user"));
            } finally {
                fields.keySet().forEach(MDC::remove);
            }
        });
    }

    /** The fields of the line an event becomes, or nothing for events not worth a line. */
    static Optional<Map<String, String>> fields(SecurityEvent event) {
        String name = switch (event.getEventType()) {
            case OIDC_LOGIN -> "signed-in";
            case OIDC_LOGOUT_RP_INITIATED -> "signed-out";
            default -> null;
        };
        if (name == null || event.getSecurityIdentity() == null) {
            return Optional.empty();
        }
        return Optional.of(Map.of("event", name,
            "user", RequestLog.subject(event.getSecurityIdentity().getPrincipal())));
    }
}
