package de.hilling.taskfest.tls;

import io.quarkus.test.common.http.TestHTTPResource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import io.restassured.RestAssured;
import java.io.IOException;
import java.net.ConnectException;
import java.net.URI;
import java.net.URL;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * The backend as the AWS task definition runs it (#247): TLS only, with a self-signed keystore
 * made by the same script, so the load balancer's connection to the task is encrypted and no plain
 * HTTP port is open beside it.
 *
 * <p>The profile sets what the {@code prod} profile sets -- insecure requests disabled -- and the
 * keystore path and password the script hands over; {@code ProdServesTlsOnlyTest} pins that the
 * {@code prod} profile really sets them. The readiness check is what the load
 * balancer's health check asks, so it is what is asked here. The load balancer does not validate a
 * target's certificate, and neither does this test.</p>
 */
@QuarkusTest
@TestProfile(ServesTlsTest.TlsOnly.class)
class ServesTlsTest {

    @TestHTTPResource(value = "/q/health/ready", tls = true)
    URL readiness;

    @Test
    void shouldAnswerTheHealthCheckOverTls() {
        RestAssured.useRelaxedHTTPSValidation();
        try {
            given().when().get(readiness).then().statusCode(200);
        } finally {
            RestAssured.reset();
        }
    }

    @Test
    void shouldOpenNoPlainHttpPort() {
        // The plain port Quarkus would test on; with insecure requests disabled, nothing listens.
        HttpClient http = HttpClient.newHttpClient();
        URI plain = URI.create("http://localhost:" + PLAIN_TEST_PORT + "/q/health/ready");

        assertThrows(ConnectException.class,
            () -> http.send(HttpRequest.newBuilder(plain).build(), HttpResponse.BodyHandlers.discarding()));
    }

    static final int PLAIN_TEST_PORT = 8081;

    /** What the task definition sets, with a keystore from the script the task starts with. */
    public static class TlsOnly implements QuarkusTestProfile {

        @Override
        public Map<String, String> getConfigOverrides() {
            Map<String, String> keystore = keystoreFromScript();
            return Map.of(
                "quarkus.http.insecure-requests", "disabled",
                "quarkus.http.test-port", String.valueOf(PLAIN_TEST_PORT),
                "quarkus.tls.key-store.p12.path", keystore.get("path"),
                "quarkus.tls.key-store.p12.password", keystore.get("password"));
        }

        /** Runs start-with-tls.sh with a stand-in `java` that only reports the keystore it was given. */
        private static Map<String, String> keystoreFromScript() {
            try {
                Path work = Files.createTempDirectory("tls");
                Path java = Files.writeString(work.resolve("java"), """
                    #!/bin/bash
                    printf '%s\\n%s\\n' "$QUARKUS_TLS_KEY_STORE_P12_PATH" "$QUARKUS_TLS_KEY_STORE_P12_PASSWORD"
                    """);
                java.toFile().setExecutable(true);
                ProcessBuilder builder = new ProcessBuilder("bash", StartWithTlsScriptTest.SCRIPT.toString());
                builder.environment().put("PATH",
                    work + ":" + Path.of(System.getProperty("java.home"), "bin") + ":/usr/bin:/bin");
                builder.environment().put("TASKFEST_TLS_KEYSTORE", work.resolve("tls.p12").toString());
                Process process = builder.start();
                String[] lines = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8).split("\n");
                if (process.waitFor() != 0) {
                    throw new IllegalStateException("start-with-tls.sh failed");
                }
                return Map.of("path", lines[0], "password", lines[1]);
            } catch (IOException | InterruptedException failure) {
                throw new IllegalStateException(failure);
            }
        }
    }
}
