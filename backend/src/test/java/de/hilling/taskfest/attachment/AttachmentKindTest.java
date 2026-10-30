package de.hilling.taskfest.attachment;

import java.util.Optional;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * What a declared content type makes of an upload, and what a link (#414) is among the kinds: a
 * kind of attachment, but never something a file can be uploaded as.
 */
class AttachmentKindTest {

    @Test
    void shouldKnowAFileByItsTypeIgnoringCaseAndParameters() {
        assertEquals(Optional.of(AttachmentKind.PNG), AttachmentKind.of("IMAGE/PNG; charset=binary"));
    }

    @Test
    void shouldNeverTakeAnUploadForALink() {
        assertEquals(Optional.empty(), AttachmentKind.of(AttachmentKind.LINK.contentType()));
    }

    @Test
    void shouldHaveALinkBeNoFileAndNoImage() {
        assertFalse(AttachmentKind.LINK.isFile());
        assertFalse(AttachmentKind.LINK.isImage());
        assertTrue(AttachmentKind.PDF.isFile());
        assertEquals("text/uri-list", AttachmentKind.LINK.contentType());
    }
}
