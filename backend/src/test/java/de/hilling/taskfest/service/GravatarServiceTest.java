package de.hilling.taskfest.service;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.time.Duration;
import java.util.Optional;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.is;

/**
 * Covers the Gravatar probe against a local server, so nothing here touches gravatar.com.
 *
 * <p>A stub server rather than a mocked client, because what is worth pinning down is how this
 * behaves against real HTTP: that 404 means "no picture" rather than an error, and that a
 * server which never answers ends the same way instead of hanging the sign-in behind it.</p>
 */
class GravatarServiceTest {

    private HttpServer server;
    private GravatarService gravatar;

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        gravatar = new GravatarService(true, Duration.ofMillis(500), GravatarUrl.DEFAULT_BASE);
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    private String urlFor(String path, int status) {
        server.createContext(path, exchange -> {
            exchange.sendResponseHeaders(status, -1);
            exchange.close();
        });
        server.start();
        return "http://127.0.0.1:" + server.getAddress().getPort() + path;
    }

    @Test
    void shouldReportAnImageWhenTheAddressAnswers200() {
        assertThat(gravatar.hasImage(urlFor("/present", 200)), is(true));
    }

    @Test
    void shouldReportNoImageOn404() {
        // The whole point of asking with d=404: this is the ordinary "nobody uploaded one" case,
        // not a failure, and it must not surface as one.
        assertThat(gravatar.hasImage(urlFor("/absent", 404)), is(false));
    }

    @Test
    void shouldTreatAnUnhelpfulStatusAsNoImage() {
        assertThat(gravatar.hasImage(urlFor("/broken", 500)), is(false));
    }

    @Test
    void shouldGiveUpRatherThanHangWhenNothingAnswers() {
        server.createContext("/slow", exchange -> {
            try {
                Thread.sleep(2_000);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
            exchange.close();
        });
        server.start();
        String url = "http://127.0.0.1:" + server.getAddress().getPort() + "/slow";

        long startedAt = System.currentTimeMillis();
        boolean found = gravatar.hasImage(url);
        long tookMillis = System.currentTimeMillis() - startedAt;

        assertThat(found, is(false));
        // The 500ms timeout is what is being checked; anything near the server's 2s sleep would
        // mean sign-in waits on a third party that has stopped answering.
        assertThat(tookMillis < 1_500, is(true));
    }

    /** A service pointed at the stub server, so the whole lookup can run without the internet. */
    private GravatarService pointedAtStub() {
        server.start();
        String base = "http://127.0.0.1:" + server.getAddress().getPort() + "/avatar/";
        return new GravatarService(true, Duration.ofMillis(500), base);
    }

    @Test
    void shouldReturnTheUrlWhenGravatarHasAPicture() {
        server.createContext("/avatar/", exchange -> {
            exchange.sendResponseHeaders(200, -1);
            exchange.close();
        });

        Optional<String> found = pointedAtStub().avatarUrlFor("gunnar@example.com");

        assertThat(found.isPresent(), is(true));
        assertThat(found.orElseThrow(), containsString(GravatarUrl.hashOf("gunnar@example.com")));
    }

    @Test
    void shouldReturnNothingWhenGravatarHasNoPicture() {
        server.createContext("/avatar/", exchange -> {
            exchange.sendResponseHeaders(404, -1);
            exchange.close();
        });

        assertThat(pointedAtStub().avatarUrlFor("gunnar@example.com"), equalTo(Optional.empty()));
    }

    @Test
    void shouldGiveUpWhenTheLookupIsInterrupted() {
        // An interrupt must leave the flag set for whoever is above us, and still answer
        // "no picture" rather than propagating out through a sign-in.
        Thread.currentThread().interrupt();
        try {
            assertThat(gravatar.hasImage(urlFor("/interrupted", 200)), is(false));
            assertThat(Thread.currentThread().isInterrupted(), is(true));
        } finally {
            Thread.interrupted();
        }
    }

    @Test
    void shouldNotAskAtAllWhenSwitchedOff() {
        GravatarService disabled =
            new GravatarService(false, Duration.ofMillis(500), GravatarUrl.DEFAULT_BASE);

        // No server is started, so a lookup that reached the network could not return empty.
        assertThat(disabled.avatarUrlFor("gunnar@example.com"), equalTo(Optional.empty()));
    }
}
