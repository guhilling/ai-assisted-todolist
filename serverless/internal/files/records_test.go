package files

import (
	"context"
	"testing"
	"time"

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

func TestTheRecordsAreListedWithTheirHashAndTime(t *testing.T) {
	f := New(localBucket(t), bucket)
	ctx := context.Background()
	for _, email := range []string{"taskfest-test-one@example.com", "taskfest-test-two@example.com"} {
		if err := f.RecordDeletion(ctx, email); err != nil {
			t.Fatal(err)
		}
	}
	link, _ := f.UploadLink(ctx, "an-attachment", "image/png", 3)
	upload(t, link, []byte("png"))

	records, err := f.Deletions(ctx)

	if err != nil {
		t.Fatal(err)
	}
	hashes := map[string]bool{}
	for _, r := range records {
		hashes[r.Hash] = true
		if time.Since(r.At) > time.Hour || r.At.After(time.Now().Add(time.Minute)) {
			t.Errorf("%s at %v", r.Hash, r.At)
		}
	}
	if len(records) != 2 || !hashes[identity.EmailHash("taskfest-test-one@example.com")] ||
		!hashes[identity.EmailHash("taskfest-test-two@example.com")] {
		t.Errorf("listed %v", records)
	}
}

func TestARecordIsPrunedOnlyWhileItIsTheOneRead(t *testing.T) {
	f := New(localBucket(t), bucket)
	ctx := context.Background()
	email := "taskfest-test-one@example.com"
	if err := f.RecordDeletion(ctx, email); err != nil {
		t.Fatal(err)
	}
	records, _ := f.Deletions(ctx)
	read := records[0]

	stale := read
	stale.At = read.At.Add(-time.Hour)
	if err := f.ForgetIfUnchanged(ctx, stale); err != nil {
		t.Fatal(err)
	}
	if again, _ := f.Deletions(ctx); len(again) != 1 {
		t.Fatal("a record written again since it was read was pruned")
	}
	if err := f.ForgetIfUnchanged(ctx, read); err != nil {
		t.Fatal(err)
	}
	if again, _ := f.Deletions(ctx); len(again) != 0 {
		t.Errorf("left: %v", again)
	}
}
