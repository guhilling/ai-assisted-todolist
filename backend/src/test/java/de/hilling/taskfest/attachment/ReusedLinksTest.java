package de.hilling.taskfest.attachment;

import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

/**
 * Handing out a download link again while it is fresh (#236), so the browser's cache, which is
 * keyed by the URL, can keep what it fetched -- a newly signed link is a new URL every time.
 */
class ReusedLinksTest {

    private static final Instant NOW = Instant.parse("2026-10-10T12:00:00Z");
    private static final Duration LIFETIME = Duration.ofHours(1);

    private final AtomicInteger signed = new AtomicInteger();

    private AttachmentStore.DownloadLink sign(Instant at) {
        return new AttachmentStore.DownloadLink("https://bucket/x?n=" + signed.incrementAndGet(), at.plus(LIFETIME));
    }

    @Test
    void shouldHandOutTheSameLinkWhileAtLeastHalfItsLifetimeIsLeft() {
        ReusedLinks links = new ReusedLinks(LIFETIME);

        var first = links.get("key", NOW, () -> sign(NOW));
        var later = links.get("key", NOW.plus(Duration.ofMinutes(30)), () -> sign(NOW));

        assertEquals(first, later);
        assertEquals(1, signed.get());
    }

    @Test
    void shouldSignANewLinkOnceLessThanHalfIsLeft() {
        ReusedLinks links = new ReusedLinks(LIFETIME);
        var first = links.get("key", NOW, () -> sign(NOW));

        Instant then = NOW.plus(Duration.ofMinutes(31));
        assertNotEquals(first, links.get("key", then, () -> sign(then)));
    }

    @Test
    void shouldKeepEachObjectsLinkApart() {
        ReusedLinks links = new ReusedLinks(LIFETIME);

        assertNotEquals(links.get("one", NOW, () -> sign(NOW)), links.get("two", NOW, () -> sign(NOW)));
    }

    @Test
    void shouldSayHowLongTheBrowserMayKeepTheAnswer() {
        // Until the backend would sign anew, so the two never disagree about which URL is current.
        ReusedLinks links = new ReusedLinks(LIFETIME);
        var link = links.get("key", NOW, () -> sign(NOW));

        assertEquals(Duration.ofMinutes(30), links.keepFor(link, NOW));
        assertEquals(Duration.ofMinutes(10), links.keepFor(link, NOW.plus(Duration.ofMinutes(20))));
        assertEquals(Duration.ZERO, links.keepFor(link, NOW.plus(Duration.ofMinutes(45))));
    }

    @Test
    void shouldForgetLinksThatHaveExpiredAndKeepTheRest() {
        ReusedLinks links = new ReusedLinks(LIFETIME);
        links.get("old", NOW, () -> sign(NOW));
        Instant later = NOW.plus(Duration.ofMinutes(50));
        links.get("new", later, () -> sign(later));

        links.forgetExpired(NOW.plus(Duration.ofMinutes(61)));

        assertEquals(1, links.size());
    }

    @Test
    void shouldNeitherReuseNorLetTheBrowserKeepALinkWhoseCredentialsExpireSoon() {
        // A presigned URL dies with the session that signed it (#236 review): one signed ten minutes
        // before the task role's credentials rotate says so in its expiry, and is signed anew.
        ReusedLinks links = new ReusedLinks(LIFETIME);
        var soon = links.get("key", NOW, () -> new AttachmentStore.DownloadLink("https://short", NOW.plus(Duration.ofMinutes(10))));

        assertEquals(Duration.ZERO, links.keepFor(soon, NOW));
        assertNotEquals(soon, links.get("key", NOW, () -> sign(NOW)));
    }

    @Test
    void shouldNotScanOnEveryRequestWhileManyLinksAreStillFresh() {
        // Tidying that frees nothing raises the mark, so a busy backend does not scan per request.
        ReusedLinks links = new ReusedLinks(LIFETIME);
        for (int i = 0; i <= 1000; i++) {
            links.get("fresh-" + i, NOW, () -> sign(NOW));
        }
        links.get("one-more", NOW, () -> sign(NOW));

        assertEquals(2002, links.tidyAbove());
    }

    @Test
    void shouldClearOutExpiredLinksOnceThereAreMany() {
        // A backend runs for weeks; links for files long removed must not pile up.
        ReusedLinks links = new ReusedLinks(LIFETIME);
        for (int i = 0; i <= 1000; i++) {
            links.get("old-" + i, NOW, () -> sign(NOW));
        }
        Instant muchLater = NOW.plus(Duration.ofHours(2));

        links.get("new", muchLater, () -> sign(muchLater));

        assertEquals(1, links.size());
    }

    @Test
    void shouldNotClearOutWhileThereAreFew() {
        ReusedLinks links = new ReusedLinks(LIFETIME);
        for (int i = 0; i < 1000; i++) {
            links.get("old-" + i, NOW, () -> sign(NOW));
        }
        Instant muchLater = NOW.plus(Duration.ofHours(2));

        links.get("new", muchLater, () -> sign(muchLater));

        assertEquals(1001, links.size());
    }
}
