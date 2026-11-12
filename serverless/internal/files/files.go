// Package files is the attachment bucket (#204, #552), and the only package that talks to S3.
// The browser moves a file's content itself, through links signed here: an upload link that only
// accepts exactly the announced size and type, both signed into it, and a link to open the file.
// The backend itself only asks whether an object is there and deletes it.
//
// Everything the Go backend writes is under Root (#578): the bucket is shared with the containers'
// backend while both run, each with its own database, and neither may take the other's files for
// orphans or prune the other's deletion records. Callers name an attachment by its bare key.
package files

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/board"
)

// Root is the prefix of everything the Go backend keeps in the bucket; attachmentPrefix and
// recordPrefix are under it. The containers' backend keeps its files at bare keys and its records
// under deleted-accounts/, and lists nothing under a prefix but those records.
const (
	Root             = "serverless/"
	attachmentPrefix = Root + "attachments/"
)

// NewClient is the S3 client the bucket is used through; endpoint is set only for LocalStack,
// which takes paths rather than bucket host names. Checksums only where S3 requires one: the SDK
// would otherwise sign one into an upload link, which the browser cannot send.
func NewClient(cfg aws.Config, endpoint string) *s3.Client {
	return s3.NewFromConfig(cfg, func(o *s3.Options) {
		o.RequestChecksumCalculation = aws.RequestChecksumCalculationWhenRequired
		o.ResponseChecksumValidation = aws.ResponseChecksumValidationWhenRequired
		if endpoint != "" {
			o.BaseEndpoint = aws.String(endpoint)
			o.UsePathStyle = true
		}
	})
}

// Files is the environment's attachment bucket.
type Files struct {
	client  *s3.Client
	presign *s3.PresignClient
	bucket  string
	links   *reused
	now     func() time.Time
}

// New returns the bucket of this name, through the client.
func New(client *s3.Client, bucket string) *Files {
	return &Files{client: client, presign: s3.NewPresignClient(client), bucket: bucket,
		links: newReused(board.DownloadLinkLifetime), now: time.Now}
}

// Link is a signed link, as the browser needs it.
type Link struct {
	URL string
	// Headers are the signed headers an upload must carry exactly, less those the browser sets
	// itself; none for a link to open a file.
	Headers map[string]string
	// ExpiresAt is until when it works: its own expiry, or its signing session's when that ends
	// first.
	ExpiresAt time.Time
}

// Object is what storage holds under a key.
type Object struct {
	ContentType string
	Size        int64
	// LastModified is when it was written.
	LastModified time.Time
}

// UploadLink is a link the browser uploads a file with. Its size and type are signed into it, so
// S3 refuses an upload of any other length or type: the limit holds on the content itself, not
// on what the browser said.
func (f *Files) UploadLink(ctx context.Context, key, contentType string, size int64) (Link, error) {
	creds, err := f.client.Options().Credentials.Retrieve(ctx)
	if err != nil {
		return Link{}, fmt.Errorf("sign an upload link: %w", err)
	}
	signed, err := f.presign.PresignPutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(f.bucket), Key: aws.String(attachmentPrefix + key),
		ContentType: aws.String(contentType), ContentLength: aws.Int64(size),
	}, s3.WithPresignExpires(board.UploadLinkLifetime), signedWith(creds))
	if err != nil {
		return Link{}, fmt.Errorf("sign an upload link: %w", err)
	}
	headers := map[string]string{}
	for name, values := range signed.SignedHeader {
		if name = http.CanonicalHeaderKey(name); name != "Host" && name != "Content-Length" {
			headers[name] = strings.Join(values, ",")
		}
	}
	return link(signed.URL, headers, creds)
}

// DownloadLink is a link the owner's browser opens a file with, inline, since images and PDFs
// show in the browser (D2 on #204), under its name. The same link is handed out again while it
// is fresh, and storage answers it with a Cache-Control for as long as it works: what is under a
// key never changes, so the browser may keep it for as long as it asks by this URL (#236).
func (f *Files) DownloadLink(ctx context.Context, key, contentType, fileName string) (Link, error) {
	return f.links.get(key, f.now(), func() (Link, error) {
		creds, err := f.client.Options().Credentials.Retrieve(ctx)
		if err != nil {
			return Link{}, fmt.Errorf("sign a link: %w", err)
		}
		signed, err := f.presign.PresignGetObject(ctx, &s3.GetObjectInput{
			Bucket: aws.String(f.bucket), Key: aws.String(attachmentPrefix + key),
			ResponseContentType:        aws.String(contentType),
			ResponseCacheControl:       aws.String("private, max-age=" + strconv.Itoa(int(board.DownloadLinkLifetime.Seconds()))),
			ResponseContentDisposition: aws.String("inline; filename*=UTF-8''" + encodeName(fileName)),
		}, s3.WithPresignExpires(board.DownloadLinkLifetime), signedWith(creds))
		if err != nil {
			return Link{}, fmt.Errorf("sign a link: %w", err)
		}
		return link(signed.URL, nil, creds)
	})
}

// signedWith signs with credentials resolved beforehand, so that their expiry is the one known:
// a presigned URL stops working when the session that signed it ends, whatever it was signed for.
func signedWith(creds aws.Credentials) func(*s3.PresignOptions) {
	return func(o *s3.PresignOptions) {
		o.ClientOptions = append(o.ClientOptions, func(c *s3.Options) {
			c.Credentials = credentials.StaticCredentialsProvider{Value: creds}
		})
	}
}

// link is a signed URL with until when it works, from the time and lifetime signed into it.
func link(signed string, headers map[string]string, creds aws.Credentials) (Link, error) {
	u, err := url.Parse(signed)
	if err != nil {
		return Link{}, err
	}
	at, err := time.Parse("20060102T150405Z", u.Query().Get("X-Amz-Date"))
	if err != nil {
		return Link{}, fmt.Errorf("a signed link without its time: %w", err)
	}
	seconds, err := strconv.Atoi(u.Query().Get("X-Amz-Expires"))
	if err != nil {
		return Link{}, fmt.Errorf("a signed link without its lifetime: %w", err)
	}
	return Link{URL: signed, Headers: headers,
		ExpiresAt: worksUntil(at.Add(time.Duration(seconds)*time.Second), creds)}, nil
}

// worksUntil is until when a link works: its own expiry, or the credentials' when they end first.
// Lambda's environment credentials tell no end, so there it is the link's own (#569).
func worksUntil(signedUntil time.Time, creds aws.Credentials) time.Time {
	if creds.CanExpire && creds.Expires.Before(signedUntil) {
		return creds.Expires
	}
	return signedUntil
}

// encodeName is a file name as Java's URLEncoder writes it, with a space as %20, as the
// Content-Disposition's filename* takes it: letters, digits and .-*_ stay, the rest goes as its
// UTF-8 bytes.
func encodeName(name string) string {
	var b strings.Builder
	for _, c := range []byte(name) {
		switch {
		case 'a' <= c && c <= 'z', 'A' <= c && c <= 'Z', '0' <= c && c <= '9', strings.IndexByte(".-*_", c) >= 0:
			b.WriteByte(c)
		default:
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}

// Head is what storage holds for the attachment key; found is false when nothing is there.
func (f *Files) Head(ctx context.Context, key string) (Object, bool, error) {
	return f.head(ctx, attachmentPrefix+key)
}

// head is what storage holds under exactly this key.
func (f *Files) head(ctx context.Context, key string) (Object, bool, error) {
	out, err := f.client.HeadObject(ctx, &s3.HeadObjectInput{Bucket: aws.String(f.bucket), Key: aws.String(key)})
	var missing *s3types.NotFound
	if errors.As(err, &missing) {
		return Object{}, false, nil
	}
	if err != nil {
		return Object{}, false, fmt.Errorf("look for %s: %w", key, err)
	}
	return Object{ContentType: aws.ToString(out.ContentType), Size: aws.ToInt64(out.ContentLength),
		LastModified: aws.ToTime(out.LastModified)}, true, nil
}

// Delete deletes the attachment key's object; deleting one that is not there is no error.
func (f *Files) Delete(ctx context.Context, key string) error {
	return f.delete(ctx, attachmentPrefix+key)
}

// delete deletes the object under exactly this key.
func (f *Files) delete(ctx context.Context, key string) error {
	_, err := f.client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(f.bucket), Key: aws.String(key)})
	if err != nil {
		return fmt.Errorf("delete %s: %w", key, err)
	}
	return nil
}

// Stored is one object in the bucket, as a listing returns it.
type Stored struct {
	// Key is the object's key, LastModified when it was written.
	Key          string
	LastModified time.Time
}

// List returns every attachment object of the Go backend, by its bare key, page by page; at a
// demo's size, a request or two. Attachment keys have no slash, so anything under a further prefix
// is something else and left out: the orphan clean-up must never take it for an orphan.
func (f *Files) List(ctx context.Context) ([]Stored, error) {
	var objects []Stored
	err := f.listUnder(ctx, attachmentPrefix, func(contents []s3types.Object) {
		objects = append(objects, stored(ctx, contents)...)
	})
	return objects, err
}

// listUnder hands every page of the objects under prefix to take.
func (f *Files) listUnder(ctx context.Context, prefix string, take func([]s3types.Object)) error {
	in := &s3.ListObjectsV2Input{Bucket: aws.String(f.bucket)}
	if prefix != "" {
		in.Prefix = aws.String(prefix)
	}
	pages := s3.NewListObjectsV2Paginator(f.client, in)
	for pages.HasMorePages() {
		page, err := pages.NextPage(ctx)
		if err != nil {
			return fmt.Errorf("list the bucket under %q: %w", prefix, err)
		}
		take(page.Contents)
	}
	return nil
}

// stored is a listing's attachment objects. One without its time is left out with a warning: S3
// always sends it, and read as the zero time it would look old enough to delete (#571).
func stored(ctx context.Context, contents []s3types.Object) []Stored {
	var objects []Stored
	for _, o := range contents {
		key := strings.TrimPrefix(aws.ToString(o.Key), attachmentPrefix)
		switch {
		case strings.Contains(key, "/"):
		case o.LastModified == nil:
			slog.WarnContext(ctx, "a listed object has no time; left out of the clean-up", "key", key)
		default:
			objects = append(objects, Stored{Key: key, LastModified: *o.LastModified})
		}
	}
	return objects
}
