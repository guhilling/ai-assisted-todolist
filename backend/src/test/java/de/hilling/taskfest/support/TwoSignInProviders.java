package de.hilling.taskfest.support;

import io.quarkus.test.junit.QuarkusTestProfile;
import java.util.HashMap;
import java.util.List;
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

    /** Where the second provider sends the browser back: a callback of its own. */
    public static final String OTHER_CALLBACK = "/api/auth/callback/other";

    /**
     * The settings every provider shares with the main one. A named tenant inherits nothing, so
     * each is set for it as a reference to the main tenant's value -- the block
     * {@code doc/authentication.md} gives for a new provider.
     */
    public static final List<String> SHARED_SETTINGS = List.of(
        "application-type",
        "authentication.restore-path-after-redirect",
        "authentication.scopes",
        "authentication.cookie-same-site",
        "authentication.cookie-force-secure",
        "authentication.java-script-auto-redirect",
        "authentication.session-age-extension",
        "token-state-manager.strategy",
        "token.refresh-expired");

    @Override
    public Map<String, String> getConfigOverrides() {
        Map<String, String> overrides = new HashMap<>(Map.of(
            "taskfest.auth.enabled", "true",
            // Dev Services imports both realms into the one Keycloak it starts.
            "quarkus.keycloak.devservices.realm-path",
            "../keycloak/realm-taskfest.json,src/test/resources/realm-other.json",
            "quarkus.oidc.other.auth-server-url", "${keycloak.url}/realms/other",
            "quarkus.oidc.other.client-id", "taskfest-backend-other",
            "quarkus.oidc.other.credentials.secret", "other-secret",
            // Its own callback, so the path alone says which provider answers: a shared one was
            // resolved by whichever provider's cookie Quarkus happened to look at first.
            "quarkus.oidc.other.tenant-paths", OTHER_LOGIN + "," + OTHER_CALLBACK,
            "quarkus.oidc.other.authentication.redirect-path", OTHER_CALLBACK,
            "taskfest.auth.providers.other.label", "Other",
            "taskfest.auth.providers.other.client-id", "taskfest-backend-other",
            "taskfest.auth.providers.other.client-secret", "other-secret"));
        SHARED_SETTINGS.forEach(setting ->
            overrides.put("quarkus.oidc.other." + setting, "${quarkus.oidc." + setting + "}"));
        return overrides;
    }
}
