package de.hilling.taskfest.service;

import org.junit.jupiter.api.Test;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.not;

/**
 * Pins down the Gravatar address derived from an email, without Quarkus and without network.
 *
 * <p>This is the half of the Gravatar work that is pure, and it is the half worth testing
 * directly: the normalisation rules are easy to get subtly wrong and impossible to notice,
 * because a wrong hash does not fail — it quietly returns somebody else's avatar, or nobody's.</p>
 */
class GravatarUrlTest {

    /**
     * Gravatar's own documented example, and the reason it carries a trailing space: the address
     * has to be trimmed and lower-cased before hashing. Verified against two independent
     * implementations rather than copied from memory.
     */
    private static final String DOCUMENTED_EMAIL = "MyEmailAddress@example.com ";
    private static final String DOCUMENTED_HASH =
        "84059b07d4be67b806386c0aad8070a23f18836bbaae342275dc0a83414c32ee";

    @Test
    void shouldHashTheDocumentedExample() {
        assertThat(GravatarUrl.hashOf(DOCUMENTED_EMAIL), equalTo(DOCUMENTED_HASH));
    }

    @Test
    void shouldTrimAndLowerCaseBeforeHashing() {
        String canonical = GravatarUrl.hashOf("gunnar@example.com");

        assertThat(GravatarUrl.hashOf("  gunnar@example.com  "), equalTo(canonical));
        assertThat(GravatarUrl.hashOf("Gunnar@Example.COM"), equalTo(canonical));
    }

    @Test
    void shouldGiveDifferentAddressesDifferentHashes() {
        assertThat(GravatarUrl.hashOf("gunnar@example.com"),
            not(equalTo(GravatarUrl.hashOf("lasse@example.com"))));
    }

    @Test
    void shouldBuildAnAvatarUrlFromTheHash() {
        String url = GravatarUrl.avatarUrl(DOCUMENTED_EMAIL);

        assertThat(url, containsString(DOCUMENTED_HASH));
        assertThat(url, containsString("https://gravatar.com/avatar/"));
    }

    @Test
    void shouldAskGravatarToAnswer404WhenThereIsNoImage() {
        // Without d=404 Gravatar invents an image, so "has an avatar" could never be answered
        // and every user would appear to have one.
        assertThat(GravatarUrl.avatarUrl("gunnar@example.com"), containsString("d=404"));
    }
}
