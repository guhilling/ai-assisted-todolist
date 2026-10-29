package de.hilling.taskfest.attachment;

import java.util.Optional;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * The rules an attachment has to meet before an upload link is handed out (#204, D1 and D2).
 *
 * <p>A plain unit test: the rules are about numbers and names, not about HTTP, the database or S3.
 * The limits are those Gunnar decided -- 10 MB a file, 2 a task, 5 a user -- passed in as the
 * configuration would.</p>
 */
class AttachmentPolicyTest {

    private static final long TEN_MB = 10L * 1024 * 1024;
    private final AttachmentPolicy policy = new AttachmentPolicy(TEN_MB, 2, 5);

    @Test
    void shouldAcceptPdfsAndTheImagesBrowsersShowInline() {
        assertEquals(Optional.of(AttachmentKind.PDF), AttachmentKind.of("application/pdf"));
        assertEquals(Optional.of(AttachmentKind.JPEG), AttachmentKind.of("image/jpeg"));
        assertEquals(Optional.of(AttachmentKind.PNG), AttachmentKind.of("image/png"));
        assertEquals(Optional.of(AttachmentKind.WEBP), AttachmentKind.of("image/webp"));
        assertEquals(Optional.of(AttachmentKind.GIF), AttachmentKind.of("image/gif"));
        assertEquals("application/pdf", AttachmentKind.PDF.contentType());
    }

    @Test
    void shouldRefuseAnythingElse() {
        assertEquals(Optional.empty(), AttachmentKind.of("text/html"));
        assertEquals(Optional.empty(), AttachmentKind.of("image/svg+xml"));
        assertEquals(Optional.empty(), AttachmentKind.of("image/heic"));
        assertEquals(Optional.empty(), AttachmentKind.of(null));
    }

    @Test
    void shouldIgnoreCaseAndParametersInAContentType() {
        assertEquals(Optional.of(AttachmentKind.PDF), AttachmentKind.of("Application/PDF; charset=binary"));
    }

    @Test
    void shouldAcceptAFileWithinEveryLimit() {
        assertEquals(Optional.empty(), policy.refusal(TEN_MB, 1, 4));
    }

    @Test
    void shouldRefuseAnEmptyFile() {
        assertEquals(Optional.of(AttachmentPolicy.Refusal.EMPTY), policy.refusal(0, 0, 0));
    }

    @Test
    void shouldRefuseAFileOverTheSizeLimit() {
        assertEquals(Optional.of(AttachmentPolicy.Refusal.TOO_LARGE), policy.refusal(TEN_MB + 1, 0, 0));
    }

    @Test
    void shouldRefuseAThirdAttachmentOnATask() {
        assertEquals(Optional.of(AttachmentPolicy.Refusal.TASK_FULL), policy.refusal(1, 2, 2));
    }

    @Test
    void shouldRefuseASixthAttachmentForAUser() {
        assertEquals(Optional.of(AttachmentPolicy.Refusal.USER_FULL), policy.refusal(1, 0, 5));
    }

    @Test
    void shouldKeepAReadableFileNameButNothingAHeaderCouldChokeOn() {
        assertEquals("Rechnung März.pdf", AttachmentPolicy.cleanFileName("Rechnung März.pdf"));
        assertEquals("evil.pdf", AttachmentPolicy.cleanFileName("../../etc/evil.pdf"));
        assertEquals("ab.pdf", AttachmentPolicy.cleanFileName("a\r\nb.pdf"));
        assertEquals("a_b.pdf", AttachmentPolicy.cleanFileName("a\"b.pdf"));
        assertEquals("attachment", AttachmentPolicy.cleanFileName("   "));
        assertEquals("scan.png", AttachmentPolicy.cleanFileName("C:\\Users\\me\\scan.png"));
    }

    @Test
    void shouldCutAFileNameToTheLengthTheColumnHolds() {
        String longest = "a".repeat(Attachment.MAX_FILE_NAME_LENGTH);
        assertEquals(longest, AttachmentPolicy.cleanFileName(longest));
        assertEquals(longest, AttachmentPolicy.cleanFileName(longest + "b"));
    }

    @Test
    void shouldCountALinkAgainstTheSameLimitsWithoutASize() {
        assertEquals(Optional.empty(), policy.countRefusal(1, 4));
        assertEquals(Optional.of(AttachmentPolicy.Refusal.TASK_FULL), policy.countRefusal(2, 0));
        assertEquals(Optional.of(AttachmentPolicy.Refusal.USER_FULL), policy.countRefusal(0, 5));
    }

    @Test
    void shouldListALinkUnderItsTitleOnOneLine() {
        String url = "https://example.com/a";
        assertEquals("Breaking: news", AttachmentPolicy.linkTitle("  Breaking:\n\tnews ", url));
        assertEquals("A/B testing \"done right\"", AttachmentPolicy.linkTitle("A/B testing \"done right\"", url));
        assertEquals(url, AttachmentPolicy.linkTitle(null, url));
        assertEquals(url, AttachmentPolicy.linkTitle(" \n ", url));
    }

    @Test
    void shouldCutALinksTitleOrUrlToTheLengthTheColumnHolds() {
        String longest = "a".repeat(Attachment.MAX_FILE_NAME_LENGTH);
        assertEquals(longest, AttachmentPolicy.linkTitle(longest + "b", "https://example.com"));
        assertEquals(Attachment.MAX_FILE_NAME_LENGTH,
            AttachmentPolicy.linkTitle(null, "https://example.com/" + longest).length());
    }
}
