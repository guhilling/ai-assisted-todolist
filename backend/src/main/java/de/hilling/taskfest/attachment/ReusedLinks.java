package de.hilling.taskfest.attachment;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Supplier;

/**
 * Download links handed out again while they are fresh (#236), per object.
 *
 * <p>The browser caches a file by its URL, and every newly signed link is a new URL: signing one per
 * request meant every board load fetched every preview again, in full. So a link is handed out
 * again for as long as at least half its lifetime is left, and the answer carrying it may be kept
 * by the browser for exactly that long ({@link #keepFor}), so browser and backend switch to the
 * next link at the same moment. Each backend task keeps its own; with two, a browser sees two URLs
 * at worst, which costs a fetch and nothing else.</p>
 */
final class ReusedLinks {

    /** How many links are kept before the expired ones are cleared out; far more than are in use. */
    private static final int TIDY_ABOVE = 1000;

    private final Map<String, AttachmentStore.DownloadLink> links = new ConcurrentHashMap<>();
    private final Duration lifetime;

    /** @param lifetime how long a newly signed link works */
    ReusedLinks(Duration lifetime) {
        this.lifetime = lifetime;
    }

    /**
     * The link to hand out for this object now: the one already signed while half its lifetime is
     * left, otherwise a newly signed one.
     *
     * @param key the object's key
     * @param now the time
     * @param sign signs a new link
     * @return the link
     */
    AttachmentStore.DownloadLink get(String key, Instant now, Supplier<AttachmentStore.DownloadLink> sign) {
        if (links.size() > TIDY_ABOVE) {
            forgetExpired(now);
        }
        return links.compute(key, (ignored, current) ->
            current != null && !now.isAfter(reusableUntil(current)) ? current : sign.get());
    }

    private Instant reusableUntil(AttachmentStore.DownloadLink link) {
        return link.expiresAt().minus(lifetime.dividedBy(2));
    }

    /** How long the browser may keep an answer carrying this link: until it would no longer be handed out. */
    Duration keepFor(AttachmentStore.DownloadLink link, Instant now) {
        Duration left = Duration.between(now, reusableUntil(link));
        return left.isNegative() ? Duration.ZERO : left;
    }

    /** Drops the links that no longer work. */
    void forgetExpired(Instant now) {
        links.values().removeIf(link -> !link.expiresAt().isAfter(now));
    }

    /** @return how many links are kept */
    int size() {
        return links.size();
    }
}
