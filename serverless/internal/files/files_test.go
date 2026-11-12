package files

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

// The LocalStack image the end-to-end stack runs; Renovate moves both.
const localStack = "localstack/localstack:4.13"

const bucket = "taskfest-test-attachments"

// localBucket starts S3 in LocalStack with signature validation on, which LocalStack skips by
// default: a test of a signed size would then pass for the wrong reason. It returns the client
// and an empty bucket.
func localBucket(t *testing.T) *s3.Client {
	t.Helper()
	if os.Getenv("CI") == "" {
		testcontainers.SkipIfProviderIsNotHealthy(t)
	}
	ctx := context.Background()
	// A plain container rather than Testcontainers' LocalStack module, which mounts the Docker
	// socket for LocalStack's Lambda and fails on podman's; S3 needs no socket.
	ctr, err := testcontainers.Run(ctx, localStack,
		testcontainers.WithEnv(map[string]string{"SERVICES": "s3", "S3_SKIP_SIGNATURE_VALIDATION": "0"}),
		testcontainers.WithExposedPorts("4566/tcp"),
		testcontainers.WithWaitStrategy(wait.ForHTTP("/_localstack/health").WithPort("4566/tcp")))
	if err != nil {
		t.Fatalf("starting LocalStack: %v", err)
	}
	t.Cleanup(func() { _ = ctr.Terminate(context.Background()) })
	host, err := ctr.Host(ctx)
	if err != nil {
		t.Fatal(err)
	}
	port, err := ctr.MappedPort(ctx, "4566/tcp")
	if err != nil {
		t.Fatal(err)
	}
	client := NewClient(aws.Config{
		Region:      "eu-central-1",
		Credentials: credentials.NewStaticCredentialsProvider("test", "test", ""),
	}, fmt.Sprintf("http://%s:%s", host, port.Port()))
	if _, err := client.CreateBucket(ctx, &s3.CreateBucketInput{Bucket: aws.String(bucket),
		CreateBucketConfiguration: &s3types.CreateBucketConfiguration{
			LocationConstraint: s3types.BucketLocationConstraintEuCentral1}}); err != nil {
		t.Fatal(err)
	}
	return client
}

// upload PUTs content to a link with the headers it was signed for, as the browser does.
func upload(t *testing.T, link Link, content []byte) int {
	t.Helper()
	req, err := http.NewRequest(http.MethodPut, link.URL, bytes.NewReader(content))
	if err != nil {
		t.Fatal(err)
	}
	for name, value := range link.Headers {
		req.Header.Set(name, value)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = res.Body.Close()
	return res.StatusCode
}

var pdf = []byte("%PDF-1.7 a very small document")

func TestAFileGoesUpThroughItsLinkAndOpensInlineUnderItsName(t *testing.T) {
	f := New(localBucket(t), bucket)
	ctx := context.Background()

	link, err := f.UploadLink(ctx, "key", "application/pdf", int64(len(pdf)))
	if err != nil {
		t.Fatal(err)
	}
	if status := upload(t, link, pdf); status != http.StatusOK {
		t.Fatalf("upload: %d", status)
	}
	object, found, err := f.Head(ctx, "key")
	if err != nil || !found || object.Size != int64(len(pdf)) || object.ContentType != "application/pdf" {
		t.Fatalf("head %+v, %v, %v", object, found, err)
	}

	open, err := f.DownloadLink(ctx, "key", "application/pdf", "Rechnung März.pdf")
	if err != nil {
		t.Fatal(err)
	}
	res, err := http.Get(open.URL)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	_ = res.Body.Close()
	if !bytes.Equal(body, pdf) {
		t.Errorf("opened %q", body)
	}
	// Inline: images and PDFs show in the browser (D2), under the original name.
	if got := res.Header.Get("Content-Disposition"); got != "inline; filename*=UTF-8''Rechnung%20M%C3%A4rz.pdf" {
		t.Errorf("Content-Disposition %q", got)
	}
	// Storage tells the browser to keep the file for as long as the link lasts (#236).
	if got := res.Header.Get("Cache-Control"); got != "private, max-age=3600" {
		t.Errorf("Cache-Control %q", got)
	}
}

func TestStorageRefusesAFileOfAnotherSizeThanSigned(t *testing.T) {
	// The size is signed into the link: one byte more and S3 itself says no.
	f := New(localBucket(t), bucket)
	link, err := f.UploadLink(context.Background(), "key", "application/pdf", int64(len(pdf)))
	if err != nil {
		t.Fatal(err)
	}

	if status := upload(t, link, append(pdf, '!')); status != http.StatusForbidden {
		t.Errorf("upload of another size: %d", status)
	}
	if _, found, _ := f.Head(context.Background(), "key"); found {
		t.Error("it arrived")
	}
}

func TestStorageRefusesAFileOfAnotherTypeThanSigned(t *testing.T) {
	f := New(localBucket(t), bucket)
	link, _ := f.UploadLink(context.Background(), "key", "application/pdf", int64(len(pdf)))
	link.Headers["Content-Type"] = "text/html"

	if status := upload(t, link, pdf); status != http.StatusForbidden {
		t.Errorf("upload of another type: %d", status)
	}
}

func TestADeletedObjectIsGoneAndDeletingNothingIsNoError(t *testing.T) {
	f := New(localBucket(t), bucket)
	ctx := context.Background()
	link, _ := f.UploadLink(ctx, "key", "image/png", 3)
	upload(t, link, []byte("png"))

	if err := f.Delete(ctx, "key"); err != nil {
		t.Fatal(err)
	}
	if _, found, err := f.Head(ctx, "key"); found || err != nil {
		t.Errorf("head after delete: %v, %v", found, err)
	}
	if err := f.Delete(ctx, "never-there"); err != nil {
		t.Error(err)
	}
}

func TestTheBrowserIsToldOnlyTheHeadersItMaySet(t *testing.T) {
	// Signed offline; nothing reaches S3. The browser sets Host and Content-Length itself.
	f := New(offline("token", time.Now().Add(time.Hour)), bucket)

	link, err := f.UploadLink(context.Background(), "key", "image/png", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(link.Headers) != 1 || link.Headers["Content-Type"] != "image/png" {
		t.Errorf("headers %v", link.Headers)
	}
}

// UploadLinkExpiryTest and LinkExpiryTest: a presigned URL dies with the session that signed it.

func offline(token string, ends time.Time) *s3.Client {
	return NewClient(aws.Config{Region: "eu-central-1",
		Credentials: aws.CredentialsProviderFunc(func(context.Context) (aws.Credentials, error) {
			return aws.Credentials{AccessKeyID: "ASIAEXAMPLE", SecretAccessKey: "example-secret",
				SessionToken: token, CanExpire: true, Expires: ends}, nil
		})}, "")
}

func query(t *testing.T, link Link, name string) string {
	t.Helper()
	u, err := url.Parse(link.URL)
	if err != nil {
		t.Fatal(err)
	}
	return u.Query().Get(name)
}

func TestALinkEndsWithTheSigningSessionWhenItExpiresFirst(t *testing.T) {
	ends := time.Now().Add(5 * time.Minute).Truncate(time.Second)
	f := New(offline("client-token", ends), bucket)

	upload, err := f.UploadLink(context.Background(), "key", "image/png", 1)
	if err != nil {
		t.Fatal(err)
	}
	open, _ := f.DownloadLink(context.Background(), "key", "image/png", "a.png")

	if !upload.ExpiresAt.Equal(ends) || !open.ExpiresAt.Equal(ends) {
		t.Errorf("upload until %v, open until %v; want %v", upload.ExpiresAt, open.ExpiresAt, ends)
	}
	if query(t, upload, "X-Amz-Security-Token") != "client-token" {
		t.Error("signed with another session than the one whose expiry it reports")
	}
}

func TestALinkEndsWithItsOwnLifetimeWhenTheSessionOutlivesIt(t *testing.T) {
	f := New(offline("token", time.Now().Add(2*time.Hour)), bucket)

	link, err := f.UploadLink(context.Background(), "key", "image/png", 1)
	if err != nil {
		t.Fatal(err)
	}
	signed, err := time.Parse("20060102T150405Z", query(t, link, "X-Amz-Date"))
	if err != nil {
		t.Fatal(err)
	}
	if query(t, link, "X-Amz-Expires") != "600" || !link.ExpiresAt.Equal(signed.Add(10*time.Minute)) {
		t.Errorf("expires %s, at %v; signed %v", query(t, link, "X-Amz-Expires"), link.ExpiresAt, signed)
	}
}

func TestALinkOfCredentialsThatDoNotExpireKeepsItsOwnExpiry(t *testing.T) {
	signed := time.Date(2026, 10, 10, 13, 0, 0, 0, time.UTC)
	if got := worksUntil(signed, aws.Credentials{}); !got.Equal(signed) {
		t.Error(got)
	}
	later := aws.Credentials{CanExpire: true, Expires: signed.Add(time.Second)}
	if got := worksUntil(signed, later); !got.Equal(signed) {
		t.Error(got)
	}
}

func TestAFileNameIsEncodedAsJavasURLEncoderDoes(t *testing.T) {
	if got := encodeName("a b*~ä.pdf"); got != "a%20b*%7E%C3%A4.pdf" {
		t.Error(got)
	}
	if strings.Contains(encodeName("x+y"), "+") {
		t.Error("a plus stayed a plus")
	}
}

func TestTheListingHoldsTheAttachmentObjectsAndNothingUnderAPrefix(t *testing.T) {
	f := New(localBucket(t), bucket)
	ctx := context.Background()
	for _, key := range []string{"one", "one.thumbnail", "deleted-accounts/abc"} {
		link, _ := f.UploadLink(ctx, key, "image/png", 3)
		if status := upload(t, link, []byte("png")); status != http.StatusOK {
			t.Fatalf("upload %s: %d", key, status)
		}
	}

	objects, err := f.List(ctx)

	if err != nil {
		t.Fatal(err)
	}
	var keys []string
	for _, o := range objects {
		keys = append(keys, o.Key)
		if time.Since(o.LastModified) > time.Hour {
			t.Errorf("%s modified %v", o.Key, o.LastModified)
		}
	}
	if strings.Join(keys, ",") != "one,one.thumbnail" {
		t.Errorf("listed %v", keys)
	}
}

// putRaw writes an object under exactly this key, as the containers' backend does, or a person.
func putRaw(t *testing.T, client *s3.Client, key string) {
	t.Helper()
	if _, err := client.PutObject(context.Background(), &s3.PutObjectInput{
		Bucket: aws.String(bucket), Key: aws.String(key), Body: strings.NewReader("x")}); err != nil {
		t.Fatal(err)
	}
}

// existsRaw says whether an object is under exactly this key.
func existsRaw(t *testing.T, client *s3.Client, key string) bool {
	t.Helper()
	_, err := client.HeadObject(context.Background(), &s3.HeadObjectInput{Bucket: aws.String(bucket), Key: aws.String(key)})
	return err == nil
}

func TestAFileIsStoredUnderTheGoBackendsOwnPrefix(t *testing.T) {
	// The bucket is shared with the containers' backend until the cut-over (#578): the Go
	// backend's files sit under a prefix of their own, so neither takes the other's for orphans.
	client := localBucket(t)
	f := New(client, bucket)
	ctx := context.Background()
	link, _ := f.UploadLink(ctx, "key", "image/png", 3)
	if status := upload(t, link, []byte("png")); status != http.StatusOK {
		t.Fatalf("upload: %d", status)
	}

	if !existsRaw(t, client, "serverless/attachments/key") || existsRaw(t, client, "key") {
		t.Error("not stored under serverless/attachments/")
	}
	if err := f.Delete(ctx, "key"); err != nil {
		t.Fatal(err)
	}
	if existsRaw(t, client, "serverless/attachments/key") {
		t.Error("deleting it left it there")
	}
}

func TestTheListingLeavesOutTheContainersFilesAndRecords(t *testing.T) {
	client := localBucket(t)
	f := New(client, bucket)
	ctx := context.Background()
	putRaw(t, client, "a-containers-file")
	putRaw(t, client, "deleted-accounts/abc")
	link, _ := f.UploadLink(ctx, "mine", "image/png", 3)
	upload(t, link, []byte("png"))

	objects, err := f.List(ctx)

	if err != nil {
		t.Fatal(err)
	}
	if len(objects) != 1 || objects[0].Key != "mine" {
		t.Errorf("listed %v", objects)
	}
}
