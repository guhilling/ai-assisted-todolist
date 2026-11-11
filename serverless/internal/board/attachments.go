package board

import (
	"errors"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf16"
)

// A task's attachments (#204, #414): files, whose content the browser moves straight to and from
// storage, and links, which are their URL and title alone. An attachment counts against the
// limits from its announcement on: pending, detached from a deleted task within the undo window,
// or on a draft (doc/decisions/domain-and-backend.md).
const (
	// MaxAttachmentBytes is the largest file accepted (D1 on #204).
	MaxAttachmentBytes = 10 << 20
	// MaxPerTask is how many attachments one task may carry (D1).
	MaxPerTask = 2
	// MaxPerUser is how many attachments one user may have altogether (D1).
	MaxPerUser = 5
	// MaxThumbnailBytes is the largest preview thumbnail offered an upload link (#236).
	MaxThumbnailBytes = 64 << 10
	// MaxFileNameLength is the longest file name or link title kept, in UTF-16 units; longer
	// ones are cut.
	MaxFileNameLength = 255
	// MaxURLLength is the longest address a link may have, in UTF-16 units.
	MaxURLLength = 2048

	// UploadLinkLifetime is how long an upload link works: long enough for 10 MB on a slow line.
	UploadLinkLifetime = 10 * time.Minute
	// DownloadLinkLifetime is how long a link to open a file works. It is handed out again while
	// half of it is left, so the browser's cache can keep the file by its URL (#236).
	DownloadLinkLifetime = time.Hour
	// UndoWindow is how long a deleted task's attachments are kept for its undo (D3): far beyond
	// the board's eight seconds, so a slow request or a tab left open never costs a file.
	UndoWindow = 10 * time.Minute
	// PendingLifetime is how long an announced upload may stay unconfirmed.
	PendingLifetime = time.Hour
)

// Kind is what an attachment is: a PDF or one of the images every browser shows inline (D2 on
// #204), or a link (#414). HEIC is left out because only Safari shows it, SVG because it is a
// document that can carry script.
type Kind string

// The kinds, as they are stored.
const (
	KindPDF  Kind = "PDF"
	KindJPEG Kind = "JPEG"
	KindPNG  Kind = "PNG"
	KindWEBP Kind = "WEBP"
	KindGIF  Kind = "GIF"
	KindLink Kind = "LINK"
)

// contentTypes is each kind's media type, which a file is uploaded and served with.
var contentTypes = map[Kind]string{
	KindPDF: "application/pdf", KindJPEG: "image/jpeg", KindPNG: "image/png", KindWEBP: "image/webp",
	KindGIF: "image/gif", KindLink: "text/uri-list",
}

// ContentType is the kind's media type; a link's is the one for a list of URLs.
func (k Kind) ContentType() string { return contentTypes[k] }

// IsFile says whether the kind has its content in storage, which a link has not.
func (k Kind) IsFile() bool { return k != KindLink && contentTypes[k] != "" }

// IsImage says whether a row previews the kind as a picture, so whether it may have a thumbnail.
func (k Kind) IsImage() bool { return k.IsFile() && k != KindPDF }

// KindOf is the kind of file a declared content type names, ignoring case and parameters. Never
// a link: a file announced as one would be a link with an object and no URL.
func KindOf(contentType string) (Kind, bool) {
	bare := strings.ToLower(strings.TrimSpace(strings.SplitN(contentType, ";", 2)[0]))
	for kind, t := range contentTypes {
		if t == bare && kind.IsFile() {
			return kind, true
		}
	}
	return "", false
}

// Attachment is one file or link, as the board lists it and the store keeps it.
type Attachment struct {
	ID        int64
	TaskID    int64
	FileName  string // a file's name, which it is opened under, or a link's title
	Kind      Kind
	SizeBytes int64 // 0 for a link
	ObjectKey string
	URL       string // a link's address; empty for a file
	Available bool   // a file's upload confirmed; a link always
	Thumbnail bool   // a preview thumbnail arrived with it (#236)
}

// ThumbnailKey is where a file's preview thumbnail is kept: beside it, so it needs no item of its
// own and goes wherever the file goes. No slash, so the orphan clean-up sees it as an attachment's.
func ThumbnailKey(objectKey string) string { return objectKey + ".thumbnail" }

// Refusal is why an attachment is refused, as the API names it for the board to say in the
// visitor's language.
type Refusal string

// The refusals.
const (
	RefusedType     Refusal = "UNSUPPORTED_TYPE"
	RefusedEmpty    Refusal = "EMPTY"
	RefusedTooLarge Refusal = "TOO_LARGE"
	RefusedTaskFull Refusal = "TASK_FULL"
	RefusedUserFull Refusal = "USER_FULL"
	// RefusedMismatch is a file that arrived other than announced; the signed link should make
	// it impossible.
	RefusedMismatch Refusal = "MISMATCH"
)

// Error makes a refusal an error, which the API answers with 422.
func (r Refusal) Error() string { return "attachment refused: " + string(r) }

// Admit says why an attachment may not be added to a task that already carries onTask, for a
// user who has ofUser, or nil when it may. A file's kind and size are checked before the counts.
func Admit(a Attachment, onTask, ofUser int) error {
	switch {
	case contentTypes[a.Kind] == "":
		return RefusedType
	case a.Kind.IsFile() && a.SizeBytes <= 0:
		return RefusedEmpty
	case a.Kind.IsFile() && a.SizeBytes > MaxAttachmentBytes:
		return RefusedTooLarge
	case onTask >= MaxPerTask:
		return RefusedTaskFull
	case ofUser >= MaxPerUser:
		return RefusedUserFull
	}
	return nil
}

// CleanFileName is the name a file is listed and opened under: the original without any path,
// control characters or quotes, which would break the Content-Disposition header it travels in,
// and cut to MaxFileNameLength.
func CleanFileName(original string) string {
	name := original[strings.LastIndexAny(original, `/\`)+1:]
	name = strings.Map(func(r rune) rune {
		switch {
		case asciiControl(r):
			return -1
		case r == '"':
			return '_'
		}
		return r
	}, name)
	name = strings.TrimFunc(name, javaWhitespace)
	if name == "" {
		return "attachment"
	}
	return cut(name, MaxFileNameLength)
}

// LinkTitle is the name a link is listed under: the page's title on one line, its runs of white
// space made one space, or the URL where there is no title, cut to MaxFileNameLength. A slash or
// a quote stays, since the title travels in no header.
func LinkTitle(title *string, url string) string {
	name := ""
	if title != nil {
		var b strings.Builder
		space := false
		for _, r := range *title {
			// Java's \s, \p{Cntrl} and \p{Z}: Unicode's no-break spaces too.
			if unicode.In(r, unicode.Zs, unicode.Zl, unicode.Zp) || asciiControl(r) || r == ' ' {
				space = true
				continue
			}
			if space {
				b.WriteByte(' ')
				space = false
			}
			b.WriteRune(r)
		}
		name = strings.TrimFunc(b.String(), javaWhitespace)
	}
	if name == "" {
		name = url
	}
	return cut(name, MaxFileNameLength)
}

// webAddress is what a link's URL must look like: http or https with a host, nothing that runs or
// embeds when opened, javascript: or data:, and no white space as Java's \s counts it.
var webAddress = regexp.MustCompile(`^(?i)https?://[^ \t\n\x0B\f\r/?#:]+(:[0-9]{1,5})?([/?#][^ \t\n\x0B\f\r]*)?$`)

// WebAddress says whether a link may have this address.
func WebAddress(url string) bool {
	return !isBlank(url) && javaLength(url) <= MaxURLLength && webAddress.MatchString(url)
}

// asciiControl is Java's \p{Cntrl}: the ASCII control characters.
func asciiControl(r rune) bool { return r < 0x20 || r == 0x7f }

// cut shortens s to at most n UTF-16 units, as Java's columns count, never through a character
// that takes two.
func cut(s string, n int) string {
	length := 0
	for i, r := range s {
		length += utf16.RuneLen(r)
		if length > n {
			return s[:i]
		}
	}
	return s
}

// ErrNotFound is an attachment, or the task it is asked for on, that is not the caller's: missing,
// gone, or someone else's, which the API answers alike.
var ErrNotFound = errors.New("no such attachment or task of the caller's")
