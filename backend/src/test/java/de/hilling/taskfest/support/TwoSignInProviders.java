package de.hilling.taskfest.support;

import io.quarkus.test.junit.QuarkusTestProfile;
import java.util.Map;

/**
 * Sign-in on, and a second provider beside the default one (#143): a second realm in the
 * Keycloak Dev Services starts, declared as a deployment would declare it -- a named OIDC tenant
 * and its {@code taskfest.auth.providers} entry, nothing in code.
 *
 * <p>Shared by every test that needs two providers, so they run in one Quarkus instance rather
 * than booting it, and Keycloak with it, once per class.</p>
 */
public class TwoSignInProviders implements QuarkusTestProfile {

    /** Where the second provider's sign-in starts: its tenant's {@code tenant-paths}. */
    public static final String OTHER_LOGIN = "/api/auth/login/other";

    @Override
    public Map<String, String> getConfigOverrides() {
        return Map.ofEntries(
            Map.entry("taskfest.auth.enabled", "true"),
            // Dev Services imports both realms into the one Keycloak it starts.
            Map.entry("quarkus.keycloak.devservices.realm-path",
                "../keycloak/realm-taskfest.json,src/test/resources/realm-other.json"),
            Map.entry("quarkus.oidc.other.auth-server-url", "${keycloak.url}/realms/other"),
            Map.entry("quarkus.oidc.other.client-id", "taskfest-backend-other"),
            Map.entry("quarkus.oidc.other.credentials.secret", "other-secret"),
            Map.entry("quarkus.oidc.other.tenant-paths", OTHER_LOGIN),
            // What every provider shares with the main one; a named tenant inherits nothing.
            Map.entry("quarkus.oidc.other.application-type", "web-app"),
            Map.entry("quarkus.oidc.other.authentication.redirect-path", "/api/auth/callback"),
            Map.entry("quarkus.oidc.other.authentication.restore-path-after-redirect", "true"),
            Map.entry("quarkus.oidc.other.authentication.scopes", "email,profile"),
            Map.entry("quarkus.oidc.other.authentication.cookie-same-site", "lax"),
            Map.entry("quarkus.oidc.other.authentication.java-script-auto-redirect", "false"),
            Map.entry("quarkus.oidc.other.authentication.session-age-extension", "PT8H"),
            Map.entry("quarkus.oidc.other.token-state-manager.strategy", "keep-all-tokens"),
            Map.entry("quarkus.oidc.other.token.refresh-expired", "true"),
            Map.entry("taskfest.auth.providers.other.label", "Other"),
            Map.entry("taskfest.auth.providers.other.client-id", "taskfest-backend-other"),
            Map.entry("taskfest.auth.providers.other.client-secret", "other-secret"));
    }
}
