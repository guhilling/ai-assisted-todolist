package de.hilling.taskfest.logging;

import io.quarkus.oidc.SecurityEvent;
import io.quarkus.security.runtime.QuarkusSecurityIdentity;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Pins down which sign-in events become a log line, and what that line carries: the event and
 * the user's pseudonymous subject, never the email address (#122). A plain test of the decision,
 * without Quarkus -- the observer that logs it is a one-liner around this. Sign-out is not an OIDC
 * event here: the app's own {@code /api/auth/logout} does it, and its access line records it.
 */
class SignInLogTest {

    private static SecurityEvent event(SecurityEvent.Type type, String subject) {
        QuarkusSecurityIdentity identity = QuarkusSecurityIdentity.builder()
            .setPrincipal(() -> subject)
            .addAttribute("email", "alice@example.com")
            .build();
        return new SecurityEvent(type, identity);
    }

    @Test
    void shouldDescribeASignIn() {
        Optional<Map<String, String>> fields = SignInLog.fields(event(SecurityEvent.Type.OIDC_LOGIN, "sub-1"));

        assertTrue(fields.isPresent());
        assertEquals("signed-in", fields.get().get("event"));
        assertEquals("sub-1", fields.get().get("user"));
        assertFalse(fields.get().containsValue("alice@example.com"));
    }

    @Test
    void shouldIgnoreASignInWithoutAnIdentity() {
        assertTrue(SignInLog.fields(new SecurityEvent(SecurityEvent.Type.OIDC_LOGIN, Map.of())).isEmpty());
    }

    @Test
    void shouldNameAnUnknownUserRatherThanFailTheSignIn() {
        assertEquals("unknown", SignInLog.fields(event(SecurityEvent.Type.OIDC_LOGIN, null)).orElseThrow().get("user"));
    }

    @Test
    void shouldIgnoreTheOtherEvents() {
        assertTrue(SignInLog.fields(event(SecurityEvent.Type.OIDC_LOGOUT_RP_INITIATED, "sub-1")).isEmpty());
    }
}
