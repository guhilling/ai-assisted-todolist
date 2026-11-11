package files

import (
	"context"
	"fmt"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"

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
