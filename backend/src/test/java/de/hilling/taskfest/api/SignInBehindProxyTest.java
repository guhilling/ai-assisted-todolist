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
 * Pins down the redirect_uri the backend sends to the identity provider when it runs behind
 * CloudFront and the load balancer, as it does in AWS.
 *
 * <p>The backend builds the callback address from the request it sees, and the load balancer
 * talks to it over plain HTTP: without trusting {@code X-Forwarded-Proto} it would ask the
 * identity provider to send the browser back to {@code http://…}, which Google refuses as an
 * unregistered redirect URI. The overrides here are the same keys the ECS task definition sets
 * as environment variables (deployment/aws-tofu/modules/environment/billable.tf); Keycloak from
 * Dev Services stands in for Google, since only the redirect it is sent matters.</p>
 */
@QuarkusTest
@TestProfile(SignInBehindProxyTest.BehindTheLoadBalancer.class)
class SignInBehindProxyTest {

    private static final String PUBLIC_HOST = "todolist-qa.cloud.hilling.de";

    @Test
    void shouldAskTheIdentityProviderToReturnToThePublicHttpsAddress() {
        String location = given()
            .redirects().follow(false)
            .header("Host", PUBLIC_HOST)
            .header("X-Forwarded-Proto", "https")
            .header("X-Forwarded-Port", "443")
            .header("X-Forwarded-For", "203.0.113.7")
            .when().get("/api/auth/login")
            .then()
            .statusCode(302)
            .extract().header("Location");

        assertThat(URLDecoder.decode(location, StandardCharsets.UTF_8),
            containsString("redirect_uri=https://" + PUBLIC_HOST + "/api/auth/callback"));
    }

    /** Sign-in on, and the proxy settings the AWS task definition passes in. */
    public static class BehindTheLoadBalancer implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            return Map.of(
                "taskfest.auth.enabled", "true",
                "quarkus.http.proxy.proxy-address-forwarding", "true",
                "quarkus.http.proxy.allow-x-forwarded", "true",
                // In AWS this is the VPC: only the load balancer can reach the task at all, and
                // its forwarded headers are believed only from inside the VPC. Here, loopback.
                "quarkus.http.proxy.trusted-proxies", "127.0.0.1/8");
        }
    }
}
