package board

import (
	"errors"
	"strings"
	"testing"
)

// AttachmentKindTest and AttachmentPolicyTest, case for case.

func TestPDFsAndTheImagesBrowsersShowInlineAreAccepted(t *testing.T) {
	for contentType, want := range map[string]Kind{"application/pdf": KindPDF, "image/jpeg": KindJPEG,
		"image/png": KindPNG, "image/webp": KindWEBP, "image/gif": KindGIF} {
		if got, ok := KindOf(contentType); !ok || got != want {
			t.Errorf("%s: %v, %v", contentType, got, ok)
		}
	}
	if KindPDF.ContentType() != "application/pdf" {
		t.Error(KindPDF.ContentType())
	}
}

func TestAnythingElseIsRefused(t *testing.T) {
	for _, contentType := range []string{"text/html", "image/svg+xml", "image/heic", ""} {
		if kind, ok := KindOf(contentType); ok {
			t.Errorf("%q was taken as %v", contentType, kind)
		}
	}
}

func TestCaseAndParametersInAContentTypeAreIgnored(t *testing.T) {
	if kind, _ := KindOf("Application/PDF; charset=binary"); kind != KindPDF {
		t.Error(kind)
	}
	if kind, _ := KindOf("IMAGE/PNG; charset=binary"); kind != KindPNG {
		t.Error(kind)
	}
}

func TestAnUploadIsNeverTakenForALink(t *testing.T) {
	if kind, ok := KindOf(KindLink.ContentType()); ok {
		t.Errorf("a file announced as %v", kind)
	}
}

func TestALinkIsNoFileAndNoImage(t *testing.T) {
	if KindLink.IsFile() || KindLink.IsImage() || !KindPDF.IsFile() || KindPDF.IsImage() || !KindGIF.IsImage() {
		t.Error("kinds")
	}
	if KindLink.ContentType() != "text/uri-list" {
		t.Error(KindLink.ContentType())
	}
}

func file(size int64) Attachment { return Attachment{Kind: KindPDF, SizeBytes: size} }

func refusedAs(t *testing.T, err error, want Refusal) {
	t.Helper()
	var got Refusal
	if !errors.As(err, &got) || got != want {
		t.Errorf("refused %v; want %s", err, want)
	}
}

func TestAFileWithinEveryLimitIsAdmitted(t *testing.T) {
	if err := Admit(file(MaxAttachmentBytes), 1, 4); err != nil {
		t.Error(err)
	}
}

func TestAnEmptyFileIsRefused(t *testing.T) {
	refusedAs(t, Admit(file(0), 0, 0), RefusedEmpty)
}

func TestAFileOverTheSizeLimitIsRefused(t *testing.T) {
	refusedAs(t, Admit(file(MaxAttachmentBytes+1), 0, 0), RefusedTooLarge)
}

func TestAThirdAttachmentOnATaskIsRefused(t *testing.T) {
	refusedAs(t, Admit(file(1), 2, 2), RefusedTaskFull)
}

func TestASixthAttachmentForAUserIsRefused(t *testing.T) {
	refusedAs(t, Admit(file(1), 0, 5), RefusedUserFull)
}

func TestAFileOfNoKnownKindIsRefusedFirst(t *testing.T) {
	refusedAs(t, Admit(Attachment{SizeBytes: 0}, 2, 5), RefusedType)
}

func TestALinkCountsAgainstTheSameLimitsWithoutASize(t *testing.T) {
	link := Attachment{Kind: KindLink}
	if err := Admit(link, 1, 4); err != nil {
		t.Error(err)
	}
	refusedAs(t, Admit(link, 2, 0), RefusedTaskFull)
	refusedAs(t, Admit(link, 0, 5), RefusedUserFull)
}

func TestAFileNameStaysReadableButKeepsNothingAHeaderCouldChokeOn(t *testing.T) {
	for given, want := range map[string]string{
		"Rechnung März.pdf": "Rechnung März.pdf", "../../etc/evil.pdf": "evil.pdf", "a\r\nb.pdf": "ab.pdf",
		"a\"b.pdf": "a_b.pdf", "   ": "attachment", "C:\\Users\\me\\scan.png": "scan.png",
	} {
		if got := CleanFileName(given); got != want {
			t.Errorf("%q: %q; want %q", given, got, want)
		}
	}
}

func TestAFileNameIsCutToTheLengthKept(t *testing.T) {
	longest := strings.Repeat("a", MaxFileNameLength)
	if CleanFileName(longest) != longest || CleanFileName(longest+"b") != longest {
		t.Error("cut")
	}
	// Never through a character that takes two UTF-16 units: half of one is no character.
	if got := CleanFileName(strings.Repeat("a", MaxFileNameLength-1) + "😀.pdf"); got != longest[1:] {
		t.Errorf("%q", got)
	}
}

func TestALinkIsListedUnderItsTitleOnOneLine(t *testing.T) {
	url := "https://example.com/a"
	title := func(s string) *string { return &s }
	for _, c := range []struct {
		title *string
		want  string
	}{
		{title("  Breaking:\n\tnews "), "Breaking: news"},
		{title(`A/B testing "done right"`), `A/B testing "done right"`},
		{nil, url},
		{title(" \n "), url},
		{title("\u00a0\u2007\u202f"), url},
	} {
		if got := LinkTitle(c.title, url); got != c.want {
			t.Errorf("%q; want %q", got, c.want)
		}
	}
}

func TestALinksTitleIsNotCutThroughACharacterThatTakesTwo(t *testing.T) {
	title := strings.Repeat("a", MaxFileNameLength-1) + "😀 and more"
	if got := LinkTitle(&title, "https://example.com"); got != strings.Repeat("a", MaxFileNameLength-1) {
		t.Errorf("%q", got)
	}
}

func TestALinksTitleOrURLIsCutToTheLengthKept(t *testing.T) {
	longest := strings.Repeat("a", MaxFileNameLength)
	over := longest + "b"
	if LinkTitle(&over, "https://example.com") != longest {
		t.Error("title")
	}
	if got := LinkTitle(nil, "https://example.com/"+longest); len(got) != MaxFileNameLength {
		t.Errorf("url cut to %d", len(got))
	}
}

func TestOnlyAWebAddressIsALink(t *testing.T) {
	// LinkAttachmentTest's: a link is opened by whoever lists it, so javascript: or data: would run.
	for _, url := range []string{"javascript:alert(1)", "data:text/html,hi", "ftp://example.com/x",
		"https://", "https://example.com/with space", "https://example.com:bad/path", "",
		"https://example.com/" + strings.Repeat("a", MaxURLLength)} {
		if WebAddress(url) {
			t.Errorf("%q was taken", url)
		}
	}
	for _, url := range []string{"https://example.com/articles/42?ref=share", "HTTP://example.com",
		"https://example.com:8443#top"} {
		if !WebAddress(url) {
			t.Errorf("%q was refused", url)
		}
	}
}

func TestAThumbnailIsKeptBesideItsFile(t *testing.T) {
	// No slash, so the orphan clean-up sees it as an attachment's object.
	if ThumbnailKey("abc") != "abc.thumbnail" {
		t.Error(ThumbnailKey("abc"))
	}
}
