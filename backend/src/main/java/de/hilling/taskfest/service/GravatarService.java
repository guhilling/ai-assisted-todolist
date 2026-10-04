package de.hilling.taskfest.service;

import io.quarkus.cache.CacheResult;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Optional;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

/**
 * Answers whether an email address has a picture on Gravatar, and where it is.
 *
 * <p>Consulted only when the identity provider supplied no picture of its own. The check is
 * made here rather than left to the browser because the issue asks for a picture "if an image
 * is available there", and only a request can answer that — an unchecked URL would leave a
 * broken image for the frontend to notice.</p>
 *
 * <p>It does not make the browser's request go away. The page still loads the image from
 * gravatar.com afterwards, so a third party still learns the reader's address and a hash of
 * their email. What this buys is a truthful answer, not privacy; {@code doc/decisions/authentication.md}
 * records that trade rather than leaving it implied.</p>
 *
 * <p>Two things keep it from being a liability on the sign-in path. The result is cached, or
 * every page load would become an outbound request, since {@code /api/auth/me} runs on all of
 * them. And a failure is not an error: if Gravatar is slow or down, the answer is "no picture"
 * and sign-in carries on. Nobody should be unable to reach their tasks because an avatar
 * service is having a bad day.</p>
 */
@ApplicationScoped
public class GravatarService {

    private static final Logger LOG = Logger.getLogger(GravatarService.class);

    /** Gravatar answers 200 when the address has a picture, and 404 when it does not. */
    private static final int FOUND = 200;

    private final boolean enabled;
    private final Duration timeout;
    private final String baseUrl;
    private final HttpClient http;

    @Inject
    public GravatarService(
        @ConfigProperty(name = "todo.gravatar.enabled", defaultValue = "true") boolean enabled,
        @ConfigProperty(name = "todo.gravatar.timeout", defaultValue = "PT2S") Duration timeout,
        @ConfigProperty(name = "todo.gravatar.base-url", defaultValue = GravatarUrl.DEFAULT_BASE) String baseUrl) {
        this.enabled = enabled;
        this.timeout = timeout;
        this.baseUrl = baseUrl;
        this.http = HttpClient.newBuilder().connectTimeout(timeout).followRedirects(HttpClient.Redirect.NEVER).build();
    }

    /**
     * The Gravatar picture for an address, or empty when there is none.
     *
     * <p>Cached by address. The cache is what makes this safe to call from {@code /api/auth/me},
     * which the browser calls on every page load.</p>
     *
     * @param email the signed-in user's address
     * @return the avatar URL when Gravatar holds an image for the address, otherwise empty
     */
    @CacheResult(cacheName = "gravatar-avatars")
    public Optional<String> avatarUrlFor(String email) {
        if (!enabled) {
            return Optional.empty();
        }

        String url = GravatarUrl.avatarUrl(baseUrl, email);
        return hasImage(url) ? Optional.of(url) : Optional.empty();
    }

    /**
     * Whether the given avatar URL resolves to an image.
     *
     * <p>Package-private, and taking the URL rather than reading it from configuration, so a
     * test can point it at a local server and exercise the 200, 404 and unreachable cases
     * without going near gravatar.com.</p>
     *
     * @param url the avatar URL to probe, which must already carry {@code d=404}
     * @return true when the request answers 200
     */
    boolean hasImage(String url) {
        HttpRequest request = HttpRequest.newBuilder(URI.create(url))
            .method("HEAD", HttpRequest.BodyPublishers.noBody())
            .timeout(timeout)
            .build();

        try {
            return http.send(request, HttpResponse.BodyHandlers.discarding()).statusCode() == FOUND;
        } catch (IOException unreachable) {
            // Deliberately not rethrown: an avatar is not worth failing a sign-in over.
            LOG.debugf("Gravatar lookup failed, carrying on without a picture: %s", unreachable.getMessage());
            return false;
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            LOG.debug("Gravatar lookup interrupted, carrying on without a picture");
            return false;
        }
    }
}
