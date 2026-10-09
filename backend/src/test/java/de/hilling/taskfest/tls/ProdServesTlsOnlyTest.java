package de.hilling.taskfest.tls;

import java.io.IOException;
import java.io.Reader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Pins down that the image serves TLS only wherever it runs with the {@code prod} profile (#247):
 * the settings themselves, as {@code application.properties} has them, rather than as a test
 * profile restates them -- and that its port is the one the load balancer and the security groups
 * use.
 *
 * <p>{@code ServesTlsTest} runs the backend with these settings; this is what keeps them in the
 * file. A plain test, reading the files: the prod profile cannot be booted in a test.</p>
 */
class ProdServesTlsOnlyTest {

    private static final Path PROPERTIES = Path.of("src/main/resources/application.properties");
    private static final Path VARIABLES = Path.of("../deployment/aws-tofu/modules/environment/variables.tf");

    @Test
    void shouldOpenNoPlainHttpPortInProd() throws IOException {
        assertEquals("disabled", properties().getProperty("%prod.quarkus.http.insecure-requests"));
    }

    @Test
    void shouldStartThroughTheScriptThatMakesTheKeystore() throws IOException {
        assertEquals("/bin/bash,/opt/taskfest/start-with-tls.sh", properties().getProperty("quarkus.jib.jvm-entrypoint"));
    }

    @Test
    void shouldServeTlsOnThePortTheInfrastructureUses() throws IOException {
        Matcher port = Pattern.compile("variable \"backend_port\" \\{[^}]*default\\s*=\\s*(\\d+)", Pattern.DOTALL)
            .matcher(Files.readString(VARIABLES));
        assertTrue(port.find(), "backend_port has a default in " + VARIABLES);
        assertEquals(port.group(1), properties().getProperty("%prod.quarkus.http.ssl-port"));
    }

    private static Properties properties() throws IOException {
        Properties properties = new Properties();
        try (Reader in = Files.newBufferedReader(PROPERTIES)) {
            properties.load(in);
        }
        return properties;
    }
}
