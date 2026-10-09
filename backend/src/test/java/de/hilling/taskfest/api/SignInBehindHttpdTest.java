package de.hilling.taskfest.api;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.junit.jupiter.api.Test;
import static io.restassured.RestAssured.given;
import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.containsString;

/**
 * Pins down the redirect_uri the backend sends when it runs behind httpd in the Compose stacks
 * (#247), where the browser talks plain HTTP to httpd on a mapped port and httpd talks TLS to the
 * backend.
 *
 * <p>The backend's own connection is TLS, so the scheme it sees is not the browser's: httpd sends
 * {@code X-Forwarded-Proto}. Trusting that alone resets the port, and the callback address lost the
 * browser's {@code :3000} -- which Keycloak, and Google, refuse. mod_proxy also sends the original
 * {@code Host} as {@code X-Forwarded-Host}, port included, which the backend trusts as well. The
 * overrides are the keys the Compose files set as environment variables.</p>
 */
@QuarkusTest
@TestProfile(SignInBehindHttpdTest.BehindHttpd.class)
class SignInBehindHttpdTest {

    private static final String BROWSER_HOST = "localhost:3000";

    @Test
    void shouldAskTheIdentityProviderToReturnToTheAddressTheBrowserUsed() {
        String location = given()
            .redirects().follow(false)
            .header("Host", BROWSER_HOST)
            // What httpd sends: its RequestHeader, and what mod_proxy adds by itself.
            .header("X-Forwarded-Proto", "http")
            .header("X-Forwarded-Host", BROWSER_HOST)
            .header("X-Forwarded-For", "172.18.0.1")
            .when().get("/api/auth/login")
            .then()
            .statusCode(302)
            .extract().header("Location");

        assertThat(URLDecoder.decode(location, StandardCharsets.UTF_8),
            containsString("redirect_uri=http://" + BROWSER_HOST + "/api/auth/callback"));
    }

    /** Sign-in on, and the proxy settings the Compose files pass in. */
    public static class BehindHttpd implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            return Map.of(
                "taskfest.auth.enabled", "true",
                "quarkus.http.proxy.proxy-address-forwarding", "true",
                "quarkus.http.proxy.allow-x-forwarded", "true",
                "quarkus.http.proxy.enable-forwarded-host", "true");
        }
    }
}
