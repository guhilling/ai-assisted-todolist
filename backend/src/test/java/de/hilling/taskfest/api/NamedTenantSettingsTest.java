package de.hilling.taskfest.api;

import de.hilling.taskfest.support.TwoSignInProviders;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Every named OIDC tenant in {@code application.properties} sets every setting it must share with
 * the main one (#143, #190).
 *
 * <p>A named tenant inherits nothing, so each shared setting is repeated for it, and a forgotten
 * one fails silently: without {@code cookie-force-secure} the session cookies lose {@code Secure}
 * in qa and prod, without {@code java-script-auto-redirect} the frontend is redirected where it
 * expects a 499. A plain test over the file itself, because the qa tenant only exists under the
 * {@code prod} profile the deployed image runs, which no {@code @QuarkusTest} boots.</p>
 */
class NamedTenantSettingsTest {

    private static final Pattern TENANT = Pattern.compile("^(%[\\w,-]+\\.)?quarkus\\.oidc\\.([a-z0-9-]+)\\.tenant-paths=",
        Pattern.MULTILINE);

    @Test
    void shouldGiveEveryNamedTenantEverySharedSetting() throws IOException {
        String properties = properties();
        List<String> missing = new ArrayList<>();
        for (String tenant : tenants(properties)) {
            for (String setting : TwoSignInProviders.SHARED_SETTINGS) {
                String key = tenant + "." + setting + "=";
                if (properties.lines().noneMatch(line -> line.startsWith(key))) {
                    missing.add(key.substring(0, key.length() - 1));
                }
            }
        }

        assertEquals(List.of(), missing);
    }

    @Test
    void shouldFindTheTestAccountsTenant() throws IOException {
        // Without a tenant to check, the test above would pass vacuously.
        assertTrue(tenants(properties()).contains("%prod.quarkus.oidc.cognito"));
    }

    private static String properties() throws IOException {
        return Files.readString(Path.of("src/main/resources/application.properties"));
    }

    /** The prefixes of the named tenants, such as {@code %prod.quarkus.oidc.cognito}. */
    private static Set<String> tenants(String properties) {
        Set<String> tenants = new TreeSet<>();
        Matcher matcher = TENANT.matcher(properties);
        while (matcher.find()) {
            tenants.add((matcher.group(1) == null ? "" : matcher.group(1)) + "quarkus.oidc." + matcher.group(2));
        }
        return tenants;
    }
}
