package files

import (
	"context"
	"testing"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/identity"
)

func TestADeletionIsRecordedUnderTheEmailsHashAndCanBeTakenBack(t *testing.T) {
	f := New(localBucket(t), bucket)
	ctx := context.Background()
	email := "taskfest-test-one@example.com"
	key := "deleted-accounts/" + identity.EmailHash(email)

	if err := f.RecordDeletion(ctx, email); err != nil {
		t.Fatal(err)
	}
	if _, found, err := f.Head(ctx, key); !found || err != nil {
		t.Fatalf("no record at %s: %v", key, err)
	}
	if objects, _ := f.List(ctx); len(objects) != 0 {
		t.Errorf("the record was listed as an attachment: %v", objects)
	}
	if err := f.ForgetDeletion(ctx, email); err != nil {
		t.Fatal(err)
	}
	if _, found, _ := f.Head(ctx, key); found {
		t.Error("the record outlived being taken back")
	}
}
