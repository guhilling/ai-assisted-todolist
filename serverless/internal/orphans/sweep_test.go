package orphans

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/files"
	"github.com/guhilling/ai-assisted-todolist/serverless/internal/store"
)

// OrphanedObjectsTest, case for case, against a bucket and items in memory; internal/files and
// internal/store test the listing and the scan against LocalStack and DynamoDB Local.

type memBucket struct {
	objects  map[string]time.Time
	failing  map[string]bool
	listings int
}

func (b *memBucket) List(context.Context) ([]files.Stored, error) {
	b.listings++
	var out []files.Stored
	for key, at := range b.objects {
		out = append(out, files.Stored{Key: key, LastModified: at})
	}
	return out, nil
}

func (b *memBucket) Head(_ context.Context, key string) (files.Object, bool, error) {
	_, ok := b.objects[key]
	return files.Object{}, ok, nil
}

func (b *memBucket) Delete(_ context.Context, key string) error {
	if b.failing[key] {
		return errors.New("S3 is down")
	}
	delete(b.objects, key)
	return nil
}

type memItems struct {
	rows []store.FileRow
	gone map[int64]bool
}

func (m *memItems) FileRows(context.Context) ([]store.FileRow, error) { return m.rows, nil }

func (m *memItems) StillAvailable(_ context.Context, r store.FileRow, _ time.Time) (bool, error) {
	return r.Available && !m.gone[r.ID], nil
}

// newBucket is a bucket holding these keys, each written at now.
func newBucket(keys ...string) *memBucket {
	b := &memBucket{objects: map[string]time.Time{}, failing: map[string]bool{}}
	for _, key := range keys {
		b.objects[key] = now
	}
	return b
}

func withAFile() *memItems {
	// A table that holds attachments, so the empty-table guard does not apply.
	return &memItems{rows: []store.FileRow{row(1, "a-file", true)}, gone: map[int64]bool{}}
}

func sweep(t *testing.T, items Items, bucket Bucket, at time.Time) Report {
	t.Helper()
	r, err := Sweep(context.Background(), items, bucket, at)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestAnObjectNothingRefersToIsDeletedOnceOlderThanTheMargin(t *testing.T) {
	b := newBucket("orphan", "a-file")

	r := sweep(t, withAFile(), b, now.Add(8*day))

	if !slices.Equal(r.Deleted, []string{"orphan"}) || r.Orphans != 1 {
		t.Errorf("%+v", r)
	}
	if _, there := b.objects["orphan"]; there {
		t.Error("still there")
	}
}

func TestMoreThanTwoSettledOrphansRaiseTheAlert(t *testing.T) {
	// Two hours on: settled, so they count towards the alert, and far from old enough to go.
	r := sweep(t, withAFile(), newBucket("a", "b", "c", "a-file"), now.Add(2*time.Hour))

	if !r.Alerted || r.Orphans != 3 || len(r.Deleted) != 0 {
		t.Errorf("%+v", r)
	}
	if r := sweep(t, withAFile(), newBucket("a", "b", "a-file"), now.Add(2*time.Hour)); r.Alerted {
		t.Error("two raised it")
	}
}

func TestAnObjectYoungerThanTheMarginIsLeftAlone(t *testing.T) {
	// It may be an upload under way, whose item is about to be written or was just confirmed.
	b := newBucket("young", "a-file")

	if r := sweep(t, withAFile(), b, now); len(r.Deleted) != 0 {
		t.Errorf("%+v", r)
	}
}

func TestAnObjectAnAttachmentRefersToIsLeftAlone(t *testing.T) {
	b := newBucket("a-file")

	if r := sweep(t, withAFile(), b, now.Add(8*day)); len(r.Deleted) != 0 || r.Orphans != 0 {
		t.Errorf("%+v", r)
	}
}

func TestAnAvailableAttachmentWhoseObjectIsMissingIsReportedButKept(t *testing.T) {
	// Deleting items is a decision about someone's data, so this is said, not repaired.
	r := sweep(t, withAFile(), newBucket(), now)

	if !slices.Equal(r.WithoutObject, []string{"USER#owner/1"}) {
		t.Errorf("%+v", r)
	}
}

func TestAnAttachmentRemovedWhileTheRunListedIsNotReported(t *testing.T) {
	items := withAFile()
	items.gone[1] = true

	if r := sweep(t, items, newBucket(), now); len(r.WithoutObject) != 0 {
		t.Errorf("%+v", r)
	}
}

func TestAPendingAttachmentWhoseUploadHasNotArrivedIsNotReported(t *testing.T) {
	items := &memItems{rows: []store.FileRow{row(1, "not-yet", false)}}

	if r := sweep(t, items, newBucket(), now); len(r.WithoutObject) != 0 {
		t.Errorf("%+v", r)
	}
}

func TestADeleteThatFailsStopsNothingElse(t *testing.T) {
	b := newBucket("first", "second", "a-file")
	b.failing["first"] = true

	r := sweep(t, withAFile(), b, now.Add(8*day))

	if !slices.Equal(r.Deleted, []string{"second"}) {
		t.Errorf("%+v", r)
	}
}

func TestAnEmptyTableDeletesNothing(t *testing.T) {
	b := newBucket("a", "b")

	r := sweep(t, &memItems{}, b, now.Add(30*day))

	if len(r.Deleted) != 0 || r.Hold != HoldNoAttachments || len(b.objects) != 2 {
		t.Errorf("%+v", r)
	}
}
