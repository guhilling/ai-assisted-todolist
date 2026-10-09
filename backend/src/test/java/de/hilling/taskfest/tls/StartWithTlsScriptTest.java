package de.hilling.taskfest.tls;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.KeyStore;
import java.security.cert.X509Certificate;
import java.util.Map;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Pins down the script the AWS task definition starts the backend with (#247): it makes a fresh
 * self-signed keystore, hands its path and password to Quarkus, and then starts the application
 * exactly as the image's own entry point does.
 *
 * <p>A plain test with no Quarkus: the script is run with a stand-in {@code java} on the path,
 * which writes down what it was started with instead of starting anything. {@code keytool} is
 * the real one, from the JDK the build runs on, as in the image.</p>
 */
class StartWithTlsScriptTest {

    static final Path SCRIPT = Path.of("src/main/jib/opt/taskfest/start-with-tls.sh");

    @TempDir
    Path work;

    @Test
    void shouldHandQuarkusAFreshKeystoreAndStartTheApplicationAsTheImageDoes() throws Exception {
        Map<String, String> started = run();

        assertEquals("-Djava.util.logging.manager=org.jboss.logmanager.LogManager -jar quarkus-run.jar",
            started.get("ARGS"));
        Path keystore = Path.of(started.get("QUARKUS_TLS_KEY_STORE_P12_PATH"));
        String password = started.get("QUARKUS_TLS_KEY_STORE_P12_PASSWORD");
        assertTrue(password.length() >= 24, "a long random password, was " + password.length());

        KeyStore store = KeyStore.getInstance("PKCS12");
        try (var in = Files.newInputStream(keystore)) {
            store.load(in, password.toCharArray());
        }
        X509Certificate certificate = (X509Certificate) store.getCertificate(store.aliases().nextElement());
        assertNotNull(certificate);
        // RSA, which every load balancer accepts from a target.
        assertEquals("RSA", certificate.getPublicKey().getAlgorithm());
    }

    @Test
    void shouldMakeANewKeyOnEveryStart() throws Exception {
        String first = run().get("QUARKUS_TLS_KEY_STORE_P12_PASSWORD");
        String second = run().get("QUARKUS_TLS_KEY_STORE_P12_PASSWORD");

        assertTrue(!first.equals(second), "each start has its own keystore and password");
    }

    /** Runs the script with a `java` that records its arguments and the TLS settings, and returns them. */
    private Map<String, String> run() throws IOException, InterruptedException {
        Path bin = Files.createDirectories(work.resolve("bin"));
        Path record = work.resolve("started.txt");
        Path java = bin.resolve("java");
        Files.writeString(java, """
            #!/bin/bash
            {
              echo "ARGS=$*"
              echo "QUARKUS_TLS_KEY_STORE_P12_PATH=$QUARKUS_TLS_KEY_STORE_P12_PATH"
              echo "QUARKUS_TLS_KEY_STORE_P12_PASSWORD=$QUARKUS_TLS_KEY_STORE_P12_PASSWORD"
            } > "%s"
            """.formatted(record));
        Files.setPosixFilePermissions(java, PosixFilePermissions.fromString("rwxr-xr-x"));
        Path keytool = Path.of(System.getProperty("java.home"), "bin");

        ProcessBuilder builder = new ProcessBuilder("bash", SCRIPT.toString()).redirectErrorStream(true);
        builder.environment().put("PATH", bin + ":" + keytool + ":/usr/bin:/bin");
        builder.environment().put("TASKFEST_TLS_KEYSTORE", work.resolve("tls-" + System.nanoTime() + ".p12").toString());
        Process process = builder.start();
        String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        assertEquals(0, process.waitFor(), output);

        return Files.readAllLines(record).stream()
            .map(line -> line.split("=", 2))
            .collect(Collectors.toMap(pair -> pair[0], pair -> pair[1]));
    }
}
