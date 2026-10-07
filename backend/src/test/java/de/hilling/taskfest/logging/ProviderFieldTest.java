package de.hilling.taskfest.logging;

import de.hilling.taskfest.api.SignInProviders;
import io.quarkus.oidc.SecurityEvent;
import io.quarkus.security.runtime.QuarkusSecurityIdentity;
import java.util.Optional;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * The {@code provider} field the sign-in and access lines carry (#143), from the tenant Quarkus
 * OIDC records on an identity. A plain unit test; {@link ProviderInLogsTest} shows Quarkus really
 * records it.
 */
class ProviderFieldTest {

    @Test
    void shouldReadTheTenantQuarkusRecordedOnTheIdentity() {
        assertEquals(Optional.of("cognito"), RequestLog.tenantOf(identityOf("cognito")));
    }

    @Test
    void shouldLeaveTheFieldOutWhenNoProviderIssuedTheIdentity() {
        QuarkusSecurityIdentity faked = QuarkusSecurityIdentity.builder().setPrincipal(() -> "alice").build();

        assertEquals(Optional.empty(), RequestLog.tenantOf(faked));
    }

    @Test
    void shouldPutTheProviderOnTheSignInLine() {
        SecurityEvent signIn = new SecurityEvent(SecurityEvent.Type.OIDC_LOGIN, identityOf(SignInProviders.DEFAULT_TENANT));

        assertEquals("google", SignInLog.fields(signIn, tenant -> SignInProviders.DEFAULT_TENANT.equals(tenant) ? "google" : tenant)
            .orElseThrow().get("provider"));
    }

    private static QuarkusSecurityIdentity identityOf(String tenant) {
        return QuarkusSecurityIdentity.builder()
            .setPrincipal(() -> "sub-1")
            .addAttribute(SignInProviders.tenantAttribute(), tenant)
            .build();
    }
}
