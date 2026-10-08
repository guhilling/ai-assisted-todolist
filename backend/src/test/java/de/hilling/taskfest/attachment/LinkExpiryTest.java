package de.hilling.taskfest.attachment;

import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Until when a download link really works (#236): a presigned URL dies with the session that signed
 * it, whatever expiry it was signed for, so the earlier of the two is the one handed out and cached.
 */
class LinkExpiryTest {

    private static final Instant SIGNED_UNTIL = Instant.parse("2026-10-10T13:00:00Z");

    @Test
    void shouldEndWithTheCredentialsWhenTheyExpireFirst() {
        Instant rotation = Instant.parse("2026-10-10T12:10:00Z");

        assertEquals(rotation, AttachmentStore.worksUntil(SIGNED_UNTIL, Optional.of(rotation)));
    }

    @Test
    void shouldKeepItsOwnExpiryWhenTheCredentialsOutliveIt() {
        assertEquals(SIGNED_UNTIL, AttachmentStore.worksUntil(SIGNED_UNTIL, Optional.of(SIGNED_UNTIL.plusSeconds(1))));
    }

    @Test
    void shouldKeepItsOwnExpiryForCredentialsThatDoNotExpire() {
        assertEquals(SIGNED_UNTIL, AttachmentStore.worksUntil(SIGNED_UNTIL, Optional.empty()));
    }
}
