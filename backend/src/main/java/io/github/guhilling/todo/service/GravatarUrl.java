package io.github.guhilling.todo.service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Locale;

/**
 * Turns an email address into the Gravatar address that may or may not hold a picture for it.
 *
 * <p>Pure on purpose. The rest of the Gravatar work is an HTTP call with a timeout and a cache,
 * and separating that from this leaves the fiddly part — normalise, hash, assemble — testable
 * without a network or a container, which is also what lets mutation testing reach it.</p>
 *
 * <p>SHA-256 rather than the legacy MD5: Gravatar accepts both and documents this one, and
 * there is no reason to derive a public identifier from an email with a broken hash.</p>
 */
public final class GravatarUrl {

    /** Gravatar itself. Overridable, because a deployment may point at a compatible mirror. */
    public static final String DEFAULT_BASE = "https://gravatar.com/avatar/";

    /**
     * {@code d=404} is what makes "has this person got an avatar?" a question the service will
     * answer. Without it it composes one, and every address appears to have a picture.
     */
    private static final String QUERY = "?d=404&s=200";

    private GravatarUrl() {
    }

    /**
     * The Gravatar identifier for an address: trimmed, lower-cased, SHA-256, hex.
     *
     * <p>The normalisation is not cosmetic. Gravatar treats the address as a literal string, so
     * {@code Gunnar@Example.com} and {@code gunnar@example.com} would otherwise be two different
     * people — and the mistake is invisible, because a wrong hash returns a perfectly valid
     * "no image here" rather than an error.</p>
     *
     * @param email the address to identify, in any case and with any surrounding whitespace
     * @return the lower-case hex SHA-256 of the normalised address
     */
    public static String hashOf(String email) {
        byte[] digest = sha256(email.trim().toLowerCase(Locale.ROOT).getBytes(StandardCharsets.UTF_8));
        return HexFormat.of().formatHex(digest);
    }

    /**
     * Where the avatar for an address would live, asking for a 404 when there is none.
     *
     * @param email the address to look up
     * @return an absolute Gravatar URL that answers 404 when the address has no picture
     */
    public static String avatarUrl(String email) {
        return avatarUrl(DEFAULT_BASE, email);
    }

    /**
     * The same, against a given base.
     *
     * <p>The base is configurable because Gravatar is not the only service that answers this
     * shape of URL — Libravatar and self-hosted mirrors do too — and because it lets the probe
     * be tested against a local server rather than the real one.</p>
     *
     * @param baseUrl the avatar endpoint, ending in a slash
     * @param email the address to look up
     * @return an absolute URL that answers 404 when the address has no picture
     */
    public static String avatarUrl(String baseUrl, String email) {
        return baseUrl + hashOf(email) + QUERY;
    }

    private static byte[] sha256(byte[] input) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(input);
        } catch (NoSuchAlgorithmException impossible) {
            // Every JVM is required to ship SHA-256; there is no recovery and no sane fallback.
            throw new IllegalStateException("SHA-256 is unavailable", impossible);
        }
    }
}
