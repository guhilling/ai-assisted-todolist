package de.hilling.taskfest.logging;

import io.quarkus.oidc.SecurityEvent;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;

/**
 * Logs who signed in, so "who signed in" has an answer in CloudWatch (#122).
 *
 * <p>Quarkus OIDC fires a {@link SecurityEvent} at the end of the authorization code flow; nothing
 * else in the application sees that moment, since the redirects never reach a REST resource. The
 * line carries the user's pseudonymous {@code sub} and the provider that issued it -- never the
 * email address, which is the decision {@code doc/deployment/observability.md} records. Signing
 * out is the application's own
 * {@code /api/auth/logout}, not an OIDC logout, so it has no event; {@link RequestLog}'s line for
 * that request, which names the user, is the record of it.</p>
 *
 * <p>The observer runs inside the sign-in itself, so nothing here may fail it: a line that cannot
 * be written is a warning, not a broken login.</p>
 */
@ApplicationScoped
public class SignInLog {

    /** The logger the sign-in lines go to; the saved "Sign-ins" query filters on it. */
    public static final String LOGGER = "de.hilling.taskfest.auth";

    private static final Logger LOG = LoggerFactory.getLogger(LOGGER);

    void log(@Observes SecurityEvent event) {
        try {
            fields(event).ifPresent(fields -> {
                fields.forEach(MDC::put);
                try {
                    LOG.info("{} {}", fields.get("event"), fields.get("user"));
                } finally {
                    fields.keySet().forEach(MDC::remove);
                }
            });
        } catch (RuntimeException e) {
            LOG.warn("Could not log a sign-in event", e);
        }
    }

    /** The fields of the line an event becomes, or nothing for events not worth a line. */
    static Optional<Map<String, String>> fields(SecurityEvent event) {
        if (event.getEventType() != SecurityEvent.Type.OIDC_LOGIN || event.getSecurityIdentity() == null) {
            return Optional.empty();
        }
        Map<String, String> fields = new LinkedHashMap<>();
        fields.put("event", "signed-in");
        fields.put("user", RequestLog.subject(event.getSecurityIdentity().getPrincipal()));
        RequestLog.provider(event.getSecurityIdentity()).ifPresent(provider -> fields.put("provider", provider));
        return Optional.of(fields);
    }
}
