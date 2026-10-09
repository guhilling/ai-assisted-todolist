package de.hilling.taskfest.health;

import java.io.IOException;
import java.net.URI;
import java.security.GeneralSecurityException;
import java.security.cert.X509Certificate;
import java.time.Duration;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

/**
 * Asks a backend over TLS whether it is serving, for the Compose stacks' health check (#247).
 *
 * <p>Since the {@code prod} profile serves TLS only, a health check has to speak it, and the image
 * cannot: UBI micro has bash but no curl, and bash's {@code /dev/tcp} speaks plain TCP. The JRE
 * can, so the check runs this class from the application's own jar --
 * {@code java -cp '/home/jboss/app/*' de.hilling.taskfest.health.ReadinessProbe <url>} -- and it
 * exits normally when the answer is 200, and with an exception otherwise.</p>
 *
 * <p>It accepts any certificate and any name, as the load balancer does: the backend's certificate
 * is self-signed and made at start, and the probe only ever asks the container it runs in.</p>
 */
public final class ReadinessProbe {

    /** How long it waits to connect and for the answer; Compose gives the whole check five seconds. */
    private static final Duration TIMEOUT = Duration.ofSeconds(3);

    private static final int OK = 200;

    private ReadinessProbe() {
    }

    /**
     * Probes the URL given, or the provider list on the default TLS port.
     *
     * @param args the URL to ask, optionally
     */
    public static void main(String[] args) {
        URI target = URI.create(args.length > 0 ? args[0] : "https://127.0.0.1:8443/api/auth/providers");
        if (!ready(target)) {
            throw new IllegalStateException("Not serving yet: " + target);
        }
    }

    /**
     * Whether the backend answers this URL with 200 over TLS.
     *
     * @param target an https URL
     * @return true for a 200, false for any other answer or none
     */
    public static boolean ready(URI target) {
        try {
            HttpsURLConnection connection = (HttpsURLConnection) target.toURL().openConnection();
            connection.setSSLSocketFactory(trustingAnything().getSocketFactory());
            connection.setHostnameVerifier((host, session) -> true);
            connection.setConnectTimeout((int) TIMEOUT.toMillis());
            connection.setReadTimeout((int) TIMEOUT.toMillis());
            try {
                return connection.getResponseCode() == OK;
            } finally {
                connection.disconnect();
            }
        } catch (IOException | GeneralSecurityException notServing) {
            return false;
        }
    }

    /** A TLS context that accepts the backend's self-signed certificate, or any other. */
    private static SSLContext trustingAnything() throws GeneralSecurityException {
        TrustManager anything = new X509TrustManager() {
            @Override
            public void checkClientTrusted(X509Certificate[] chain, String authType) {
                // Not a server: no client certificates to check.
            }

            @Override
            public void checkServerTrusted(X509Certificate[] chain, String authType) {
                // Self-signed and made at start: there is nothing to check it against.
            }

            @Override
            public X509Certificate[] getAcceptedIssuers() {
                return new X509Certificate[0];
            }
        };
        SSLContext context = SSLContext.getInstance("TLS");
        context.init(null, new TrustManager[] {anything}, null);
        return context;
    }
}
