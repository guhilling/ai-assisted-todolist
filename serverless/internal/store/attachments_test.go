package store

import (
	"context"
	"errors"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/board"
)

func pdfFile(name string) board.Attachment {
	return board.Attachment{FileName: name, Kind: board.KindPDF, SizeBytes: 10}
}

func link(title string) board.Attachment {
	return board.Attachment{FileName: title, Kind: board.KindLink, URL: "https://example.com/a", Available: true}
}

func attach(t *testing.T, w *Writes, email string, taskID int64, a board.Attachment, now time.Time) board.Attachment {
	t.Helper()
	got, err := w.Attach(context.Background(), email, taskID, a, now)
	if err != nil {
		t.Fatalf("attach %s: %v", a.FileName, err)
	}
	return got
}

func refusedAs(t *testing.T, err error, want board.Refusal) {
	t.Helper()
	var got board.Refusal
	if !errors.As(err, &got) || got != want {
		t.Errorf("%v; want %s", err, want)
	}
}

func attachmentsOn(t *testing.T, s *Store, email string, taskID int64, now time.Time) []board.Attachment {
	t.Helper()
	all, err := s.Attachments(context.Background(), email, now)
	if err != nil {
		t.Fatal(err)
	}
	return all[taskID]
}

func expiresAt(t *testing.T, client *dynamodb.Client, table, email string, id int64) string {
	t.Helper()
	out, err := client.GetItem(context.Background(), &dynamodb.GetItemInput{
		TableName: aws.String(table), Key: attachmentKey(email, id)})
	if err != nil {
		t.Fatal(err)
	}
	n, ok := out.Item["expiresAt"].(*types.AttributeValueMemberN)
	if !ok {
		return ""
	}
	return n.Value
}

func unix(t time.Time) string { return strconv.FormatInt(t.Unix(), 10) }

func TestAnAnnouncedFileIsPendingOffTheBoardUntilConfirmed(t *testing.T) {
	client, table := localTable(t)
	w, s := NewWrites(client, table), New(client, table)
	ctx := context.Background()
	task, _ := w.Create(ctx, one, newTask("Pay the invoice"))

	a := attach(t, w, one, task.ID, pdfFile("Rechnung.pdf"), started)

	if a.ID != 1 || a.TaskID != task.ID || a.Available || a.ObjectKey == "" {
		t.Fatalf("announced %+v", a)
	}
	if got := attachmentsOn(t, s, one, task.ID, started); len(got) != 0 {
		t.Errorf("a pending file on the board: %+v", got)
	}
	// An upload never confirmed goes after the pending lifetime: DynamoDB's TTL deletes it.
	if got := expiresAt(t, client, table, one, a.ID); got != unix(started.Add(board.PendingLifetime)) {
		t.Errorf("expiresAt %s", got)
	}

	confirmed, err := w.Confirm(ctx, one, task.ID, a.ID, true, started)
	if err != nil || !confirmed.Available || !confirmed.Thumbnail {
		t.Fatalf("confirmed %+v, %v", confirmed, err)
	}
	if got := attachmentsOn(t, s, one, task.ID, started); len(got) != 1 || got[0].FileName != "Rechnung.pdf" {
		t.Errorf("board %+v", got)
	}
	if got := expiresAt(t, client, table, one, a.ID); got != "" {
		t.Errorf("a confirmed file still expires at %s", got)
	}
	found, err := w.Attachment(ctx, one, task.ID, a.ID, started)
	if err != nil || found.ObjectKey != a.ObjectKey || !found.Available {
		t.Errorf("found %+v, %v", found, err)
	}
}

func TestEachFileHasAKeyOfItsOwnThatSaysNothingOfIt(t *testing.T) {
	client, table := localTable(t)
	w := NewWrites(client, table)
	task, _ := w.Create(context.Background(), one, newTask("Two scans"))

	first := attach(t, w, one, task.ID, pdfFile("a.pdf"), started)
	second := attach(t, w, one, task.ID, pdfFile("a.pdf"), started)

	if first.ObjectKey == second.ObjectKey || first.ID == second.ID {
		t.Errorf("%+v and %+v", first, second)
	}
	for _, c := range first.ObjectKey {
		if c == '/' {
			t.Errorf("a slash in %s, which the orphan clean-up would leave", first.ObjectKey)
		}
	}
}

func TestALinkIsAvailableAtOnceWithNoObject(t *testing.T) {
	client, table := localTable(t)
	w, s := NewWrites(client, table), New(client, table)
	task, _ := w.Create(context.Background(), one, newTask("Read later"))

	a := attach(t, w, one, task.ID, link("An article"), started)

	if !a.Available || a.ObjectKey != "" || a.URL != "https://example.com/a" {
		t.Fatalf("link %+v", a)
	}
	if got := attachmentsOn(t, s, one, task.ID, started); len(got) != 1 || got[0].URL != a.URL {
		t.Errorf("board %+v", got)
	}
	if got := expiresAt(t, client, table, one, a.ID); got != "" {
		t.Errorf("a link expires at %s", got)
	}
}

func TestAThirdAttachmentOnATaskIsRefusedFilesAndLinksAlike(t *testing.T) {
	client, table := localTable(t)
	w := NewWrites(client, table)
	task, _ := w.Create(context.Background(), one, newTask("Two at most"))
	attach(t, w, one, task.ID, pdfFile("one.pdf"), started)
	attach(t, w, one, task.ID, link("Two"), started)

	_, err := w.Attach(context.Background(), one, task.ID, link("Three"), started)

	refusedAs(t, err, board.RefusedTaskFull)
}

func TestASixthAttachmentForAUserIsRefusedCountingPendingOnes(t *testing.T) {
	client, table := localTable(t)
	w := NewWrites(client, table)
	ctx := context.Background()
	for task := range 3 {
		created, _ := w.Create(ctx, one, newTask("Task"))
		for range min(2, 5-2*task) {
			attach(t, w, one, created.ID, pdfFile("f.pdf"), started)
		}
	}
	another, _ := w.Create(ctx, one, newTask("One too many"))

	_, err := w.Attach(ctx, one, another.ID, pdfFile("six.pdf"), started)

	refusedAs(t, err, board.RefusedUserFull)
	// Another user counts on their own.
	theirs, _ := w.Create(ctx, two, newTask("Theirs"))
	attach(t, w, two, theirs.ID, pdfFile("theirs.pdf"), started)
}

func TestTheKindAndSizeAreCheckedBeforeTheCounts(t *testing.T) {
	client, table := localTable(t)
	w := NewWrites(client, table)
	task, _ := w.Create(context.Background(), one, newTask("Paperwork"))

	_, err := w.Attach(context.Background(), one, task.ID, board.Attachment{FileName: "page.html", SizeBytes: 10}, started)
	refusedAs(t, err, board.RefusedType)
	_, err = w.Attach(context.Background(), one, task.ID,
		board.Attachment{FileName: "huge.pdf", Kind: board.KindPDF, SizeBytes: board.MaxAttachmentBytes + 1}, started)
	refusedAs(t, err, board.RefusedTooLarge)
}

func TestFilesAnnouncedAtOnceKeepToTheLimit(t *testing.T) {
	// A multi-file drop announces in parallel; counting and writing must not interleave, which
	// the version on the META item guarantees, as for drafts.
	client, table := localTable(t)
	w := NewWrites(client, table)
	task, _ := w.Create(context.Background(), one, newTask("Dropped six files"))

	const racers = 6
	var wg sync.WaitGroup
	accepted := make(chan bool, racers)
	for range racers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := w.Attach(context.Background(), one, task.ID, pdfFile("drop.pdf"), started)
			var refusal board.Refusal
			if err != nil && !errors.As(err, &refusal) {
				t.Error(err)
			}
			accepted <- err == nil
		}()
	}
	wg.Wait()
	close(accepted)

	n := 0
	for ok := range accepted {
		if ok {
			n++
		}
	}
	if n != board.MaxPerTask {
		t.Errorf("%d of %d announced at once, with room for %d", n, racers, board.MaxPerTask)
	}
}

func TestSomeoneElsesTaskAndAttachmentAreNotFound(t *testing.T) {
	client, table := localTable(t)
	w := NewWrites(client, table)
	ctx := context.Background()
	theirs, _ := w.Create(ctx, two, newTask("Private"))
	secret := attach(t, w, two, theirs.ID, pdfFile("secret.pdf"), started)

	if _, err := w.Attach(ctx, one, theirs.ID, pdfFile("mine.pdf"), started); !errors.Is(err, board.ErrNotFound) {
		t.Errorf("attach to theirs: %v", err)
	}
	if _, err := w.Attachment(ctx, one, theirs.ID, secret.ID, started); !errors.Is(err, board.ErrNotFound) {
		t.Errorf("find theirs: %v", err)
	}
	if _, err := w.Confirm(ctx, one, theirs.ID, secret.ID, false, started); !errors.Is(err, board.ErrNotFound) {
		t.Errorf("confirm theirs: %v", err)
	}
	// Nor is one of the caller's own under another task's id.
	mine, _ := w.Create(ctx, one, newTask("Mine"))
	other, _ := w.Create(ctx, one, newTask("Other"))
	a := attach(t, w, one, mine.ID, pdfFile("a.pdf"), started)
	if _, err := w.Attachment(ctx, one, other.ID, a.ID, started); !errors.Is(err, board.ErrNotFound) {
		t.Errorf("under another task: %v", err)
	}
}

func TestAnUploadNeverConfirmedIsGoneOnceItsLifetimeHasPassed(t *testing.T) {
	client, table := localTable(t)
	w := NewWrites(client, table)
	ctx := context.Background()
	task, _ := w.Create(ctx, one, newTask("Never uploaded"))
	a := attach(t, w, one, task.ID, pdfFile("lost.pdf"), started)
	attach(t, w, one, task.ID, pdfFile("other.pdf"), started)
	later := started.Add(board.PendingLifetime + time.Second)

	if _, err := w.Confirm(ctx, one, task.ID, a.ID, false, later); !errors.Is(err, board.ErrNotFound) {
		t.Errorf("confirmed after its lifetime: %v", err)
	}
	// Nor does it count any more: TTL deletes within days, not at once.
	attach(t, w, one, task.ID, pdfFile("again.pdf"), later)
}

func TestARemovedAttachmentIsGoneAndMakesRoom(t *testing.T) {
	client, table := localTable(t)
	w, s := NewWrites(client, table), New(client, table)
	ctx := context.Background()
	task, _ := w.Create(ctx, one, newTask("Remove one"))
	a := attach(t, w, one, task.ID, link("One"), started)
	attach(t, w, one, task.ID, link("Two"), started)

	if err := w.RemoveAttachment(ctx, one, a.ID); err != nil {
		t.Fatal(err)
	}

	if got := attachmentsOn(t, s, one, task.ID, started); len(got) != 1 || got[0].FileName != "Two" {
		t.Errorf("board %+v", got)
	}
	attach(t, w, one, task.ID, link("Three"), started)
	// Removing one already gone is no error: a retry whose answer was lost.
	if err := w.RemoveAttachment(ctx, one, a.ID); err != nil {
		t.Error(err)
	}
}

func TestADeletedTasksAttachmentsComeBackWithItsUndo(t *testing.T) {
	client, table := localTable(t)
	w, s := NewWrites(client, table), New(client, table)
	ctx := context.Background()
	task, _ := w.Create(ctx, one, newTask("Deleted by mistake"))
	a := attach(t, w, one, task.ID, link("Kept for the undo"), started)
	w.clock = func() time.Time { return started }

	if found, err := w.Delete(ctx, one, task.ID); !found || err != nil {
		t.Fatalf("delete: %v, %v", found, err)
	}
	// Kept for the undo window: TTL deletes it after that, and it counts until then.
	if got := expiresAt(t, client, table, one, a.ID); got != unix(started.Add(board.UndoWindow)) {
		t.Errorf("expiresAt %s", got)
	}

	restored, _ := w.Create(ctx, one, newTask("Deleted by mistake"))
	if err := w.Reattach(ctx, one, restored.ID, []int64{a.ID}, started.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if got := attachmentsOn(t, s, one, restored.ID, started); len(got) != 1 || got[0].ID != a.ID {
		t.Errorf("restored with %+v", got)
	}
	if got := expiresAt(t, client, table, one, a.ID); got != "" {
		t.Errorf("a reattached link expires at %s", got)
	}
}

func TestAnUndoAfterTheWindowBringsNothingBack(t *testing.T) {
	client, table := localTable(t)
	w, s := NewWrites(client, table), New(client, table)
	ctx := context.Background()
	task, _ := w.Create(ctx, one, newTask("Gone for good"))
	a := attach(t, w, one, task.ID, link("Too late"), started)
	w.clock = func() time.Time { return started }
	_, _ = w.Delete(ctx, one, task.ID)
	later := started.Add(board.UndoWindow + time.Second)

	restored, _ := w.Create(ctx, one, newTask("Gone for good"))
	if err := w.Reattach(ctx, one, restored.ID, []int64{a.ID}, later); err != nil {
		t.Fatal(err)
	}

	if got := attachmentsOn(t, s, one, restored.ID, later); len(got) != 0 {
		t.Errorf("brought back %+v", got)
	}
}

func TestAnUndoPutsNoMoreOnATaskThanTheLimitNorAnotherUsersOrAnAttachedOne(t *testing.T) {
	client, table := localTable(t)
	w, s := NewWrites(client, table), New(client, table)
	ctx := context.Background()
	w.clock = func() time.Time { return started }
	var ids []int64
	for range 2 {
		task, _ := w.Create(ctx, one, newTask("Deleted"))
		for range 2 {
			ids = append(ids, attach(t, w, one, task.ID, link("L"), started).ID)
		}
		_, _ = w.Delete(ctx, one, task.ID)
	}
	kept, _ := w.Create(ctx, one, newTask("Still there"))
	theirs, _ := w.Create(ctx, two, newTask("Theirs"))
	attached := attach(t, w, two, theirs.ID, link("Theirs"), started)

	greedy, _ := w.Create(ctx, one, newTask("Greedy"))
	if err := w.Reattach(ctx, one, greedy.ID, append(ids, attached.ID), started); err != nil {
		t.Fatal(err)
	}

	if got := attachmentsOn(t, s, one, greedy.ID, started); len(got) != board.MaxPerTask ||
		got[0].ID != ids[0] || got[1].ID != ids[1] {
		t.Errorf("greedy undo brought %+v", got)
	}
	if got := attachmentsOn(t, s, two, theirs.ID, started); len(got) != 1 {
		t.Errorf("theirs %+v", got)
	}
	_ = kept
}

func TestADraftsAttachmentsGoWithItUnlessItIsAdded(t *testing.T) {
	client, table := localTable(t)
	w, s := NewWrites(client, table), New(client, table)
	ctx := context.Background()
	draft := startDraft(t, w, one, started)
	a := attach(t, w, one, draft, pdfFile("Scan.pdf"), started.Add(time.Minute))
	if _, err := w.Confirm(ctx, one, draft, a.ID, false, started.Add(2*time.Minute)); err != nil {
		t.Fatal(err)
	}
	// A draft's file lasts as long as the draft (#381): TTL deletes both together.
	if got := expiresAt(t, client, table, one, a.ID); got != unix(started.Add(board.DraftLifetime)) {
		t.Errorf("expiresAt %s", got)
	}

	added, found, err := w.AddDraft(ctx, one, withID(newTask("File the scan"), draft), started.Add(3*time.Minute))
	if err != nil || !found {
		t.Fatalf("add: %+v, %v, %v", added, found, err)
	}
	if got := attachmentsOn(t, s, one, draft, started); len(got) != 1 || got[0].ID != a.ID {
		t.Errorf("the task has %+v", got)
	}
	if got := expiresAt(t, client, table, one, a.ID); got != "" {
		t.Errorf("an added draft's file still expires at %s", got)
	}
}

func TestAnAbandonedDraftsAttachmentsStopCountingWithIt(t *testing.T) {
	client, table := localTable(t)
	w := NewWrites(client, table)
	ctx := context.Background()
	draft := startDraft(t, w, one, started)
	a := attach(t, w, one, draft, pdfFile("Forgotten.pdf"), started)
	later := started.Add(board.DraftLifetime + time.Second)

	if _, err := w.Attachment(ctx, one, draft, a.ID, later); !errors.Is(err, board.ErrNotFound) {
		t.Errorf("found after the draft expired: %v", err)
	}
	if _, err := w.Attach(ctx, one, draft, pdfFile("late.pdf"), later); !errors.Is(err, board.ErrNotFound) {
		t.Errorf("attached to an expired draft: %v", err)
	}
	task, _ := w.Create(ctx, one, newTask("Elsewhere"))
	for range 2 {
		attach(t, w, one, task.ID, pdfFile("f.pdf"), later)
	}
	other, _ := w.Create(ctx, one, newTask("And here"))
	for range 2 {
		attach(t, w, one, other.ID, pdfFile("f.pdf"), later)
	}
	third, _ := w.Create(ctx, one, newTask("The fifth"))
	attach(t, w, one, third.ID, pdfFile("f.pdf"), later)
}

func TestADiscardedDraftTakesItsAttachmentsWithIt(t *testing.T) {
	client, table := localTable(t)
	w := NewWrites(client, table)
	ctx := context.Background()
	draft := startDraft(t, w, one, started)
	a := attach(t, w, one, draft, link("Unwanted"), started)

	if found, err := w.DiscardDraft(ctx, one, draft, started); !found || err != nil {
		t.Fatalf("discard: %v, %v", found, err)
	}

	out, err := client.GetItem(ctx, &dynamodb.GetItemInput{TableName: aws.String(table), Key: attachmentKey(one, a.ID)})
	if err != nil || len(out.Item) != 0 {
		t.Errorf("still there: %v, %v", out.Item, err)
	}
}

func TestAnAttachmentAnnouncedOnADraftBeingAddedEndsUpOnTheTask(t *testing.T) {
	// The add counts the version up, so an attach that read the draft writes again and finds the
	// task; either order leaves the file on the task, never with the draft's expiry.
	client, table := localTable(t)
	w, s := NewWrites(client, table), New(client, table)
	ctx := context.Background()
	for range 10 {
		draft := startDraft(t, w, one, started)
		var wg sync.WaitGroup
		var a board.Attachment
		wg.Add(2)
		go func() {
			defer wg.Done()
			var err error
			if a, err = w.Attach(ctx, one, draft, link("Racing"), started); err != nil {
				t.Error(err)
			}
		}()
		go func() {
			defer wg.Done()
			_, _, _ = w.AddDraft(ctx, one, withID(newTask("Added"), draft), started)
		}()
		wg.Wait()
		if got := expiresAt(t, client, table, one, a.ID); got != "" {
			t.Fatalf("the link on task %d expires at %s", draft, got)
		}
		if got := attachmentsOn(t, s, one, draft, started); len(got) != 1 {
			t.Fatalf("task %d has %+v", draft, got)
		}
		_ = w.RemoveAttachment(ctx, one, a.ID)
	}
}
