package files

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/identity"
)

// recordPrefix is where the deletion records live in the bucket (#213, #553), as the Quarkus
// backend keeps them: attachment keys have no slash, so List never takes a record for an orphan.
const recordPrefix = "deleted-accounts/"

// recordBody only says what the object is, for a person who finds it; its time is the object's.
const recordBody = "TaskFest account deletion record (#213); the time is this object's."

// RecordDeletion records that the account with this email is being deleted now, replacing an
// older record. It lives outside the table, so that a restore of the table cannot take it back.
func (f *Files) RecordDeletion(ctx context.Context, email string) error {
	_, err := f.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(f.bucket), Key: aws.String(recordPrefix + identity.EmailHash(email)),
		Body: strings.NewReader(recordBody), ContentType: aws.String("text/plain; charset=utf-8"),
	})
	if err != nil {
		return fmt.Errorf("record the deletion: %w", err)
	}
	return nil
}

// ForgetDeletion takes back the record of a deletion that did not go through, so that the replay
// never carries out a deletion the user was told failed.
func (f *Files) ForgetDeletion(ctx context.Context, email string) error {
	return f.Delete(ctx, recordPrefix+identity.EmailHash(email))
}

// Deletion is a deletion on record: the email's hash, and when the account was deleted, which is
// the time S3 wrote the record.
type Deletion struct {
	Hash string
	At   time.Time
}

// Deletions is every deletion on record, in one listing; the times are the objects' own.
func (f *Files) Deletions(ctx context.Context) ([]Deletion, error) {
	var records []Deletion
	pages := s3.NewListObjectsV2Paginator(f.client, &s3.ListObjectsV2Input{
		Bucket: aws.String(f.bucket), Prefix: aws.String(recordPrefix)})
	for pages.HasMorePages() {
		page, err := pages.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("list the deletion records: %w", err)
		}
		for _, o := range page.Contents {
			hash := strings.TrimPrefix(aws.ToString(o.Key), recordPrefix)
			if hash == "" || strings.Contains(hash, "/") || o.LastModified == nil {
				continue
			}
			records = append(records, Deletion{Hash: hash, At: *o.LastModified})
		}
	}
	return records, nil
}

// ForgetIfUnchanged removes a record no restore can need any more, unless it was written again
// since it was read: then it records a newer deletion, and stays.
func (f *Files) ForgetIfUnchanged(ctx context.Context, d Deletion) error {
	key := recordPrefix + d.Hash
	out, err := f.client.HeadObject(ctx, &s3.HeadObjectInput{Bucket: aws.String(f.bucket), Key: aws.String(key)})
	var missing *s3types.NotFound
	if errors.As(err, &missing) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("look for the record: %w", err)
	}
	if out.LastModified == nil || !out.LastModified.Equal(d.At) {
		return nil
	}
	return f.Delete(ctx, key)
}
