package store

import (
	"context"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/board"
)

// started is when the drafts in these tests are started: 2026-11-10 at noon UTC.
var started = time.Date(2026, 11, 10, 12, 0, 0, 0, time.UTC)

func startDraft(t *testing.T, w *Writes, email string, now time.Time) int64 {
	t.Helper()
	id, ok, err := w.StartDraft(context.Background(), email, now)
	if err != nil || !ok {
		t.Fatalf("start a draft: %v, %v", ok, err)
	}
	return id
}

func TestADraftTakesTheNextTaskIDAndIsNoTask(t *testing.T) {
	client, table := localTable(t)
	w, s := NewWrites(client, table), New(client, table)
	ctx := context.Background()

	draft := startDraft(t, w, one, started)
	task, _ := w.Create(ctx, one, newTask("After the draft"))

	// Ids come from the one count, so a draft keeps its id when it is added (#381).
	if draft != 1 || task.ID != 2 {
		t.Errorf("draft %d, task %d", draft, task.ID)
	}
	if mine := boardOf(t, s, one); len(mine) != 1 {
		t.Errorf("board %+v", mine)
	}
	if _, found, _ := w.Replace(ctx, one, board.Task{ID: draft, Description: "A draft",
		DueDate: "2099-11-30", Importance: board.ImportanceLow, State: board.StateTodo}, false); found {
		t.Error("a draft was replaced as a task")
	}
	if found, _ := w.Delete(ctx, one, draft); found {
		t.Error("a draft was deleted as a task")
	}
}

func TestADraftExpiresThroughTTLAtTheEndOfItsLifetime(t *testing.T) {
	client, table := localTable(t)
	w := NewWrites(client, table)
	id := startDraft(t, w, one, started)

	out, err := client.GetItem(context.Background(), &dynamodb.GetItemInput{
		TableName: aws.String(table), Key: draftKey(one, id)})
	if err != nil {
		t.Fatal(err)
	}
	// expiresAt is the table's TTL attribute (#554): the sweep becomes DynamoDB deleting the item.
	got, ok := out.Item["expiresAt"].(*types.AttributeValueMemberN)
	want := started.Add(board.DraftLifetime).Unix()
	if !ok || got.Value != strconv.FormatInt(want, 10) {
		t.Errorf("expiresAt %v, want %d", out.Item["expiresAt"], want)
	}
}

func TestASixthOpenDraftIsRefusedAndOneGoneMakesRoom(t *testing.T) {
	client, table := localTable(t)
	w := NewWrites(client, table)
	ctx := context.Background()
	first := startDraft(t, w, one, started)
	second := startDraft(t, w, one, started)
	for range board.MaxOpenDrafts - 2 {
		startDraft(t, w, one, started)
	}

	if _, ok, err := w.StartDraft(ctx, one, started); ok || err != nil {
		t.Fatalf("a sixth draft: %v, %v", ok, err)
	}
	if found, err := w.DiscardDraft(ctx, one, first, started); !found || err != nil {
		t.Fatalf("discard: %v, %v", found, err)
	}
	startDraft(t, w, one, started)
	if _, found, err := w.AddDraft(ctx, one, withID(newTask("No draft any more"), second), started); !found || err != nil {
		t.Fatalf("add: %v, %v", found, err)
	}
	startDraft(t, w, one, started)
	if _, ok, _ := w.StartDraft(ctx, one, started); ok {
		t.Error("a sixth draft after making room twice")
	}
	// Another user counts on their own.
	startDraft(t, w, two, started)
}

func TestDraftsStartedAtOnceKeepToTheLimit(t *testing.T) {
	// Add forms opened at once: counting and writing must not interleave (#434), which the
	// version on the META item guarantees.
	client, table := localTable(t)
	w := NewWrites(client, table)
	for range board.MaxOpenDrafts - 1 {
		startDraft(t, w, one, started)
	}

	const racers = 6
	var wg sync.WaitGroup
	results := make(chan bool, racers)
	for range racers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, ok, err := w.StartDraft(context.Background(), one, started)
			if err != nil {
				t.Error(err)
			}
			results <- ok
		}()
	}
	wg.Wait()
	close(results)

	started := 0
	for ok := range results {
		if ok {
			started++
		}
	}
	if started != 1 {
		t.Errorf("%d of %d drafts started at once, with room for one", started, racers)
	}
}

func TestAnExpiredDraftIsGoneBeforeTTLDeletesIt(t *testing.T) {
	// TTL deletes within about two days of expiry, so an expired draft must read as gone.
	client, table := localTable(t)
	w := NewWrites(client, table)
	ctx := context.Background()
	var ids []int64
	for range board.MaxOpenDrafts {
		ids = append(ids, startDraft(t, w, one, started))
	}
	later := started.Add(board.DraftLifetime + time.Second)

	if found, _ := w.DiscardDraft(ctx, one, ids[0], later); found {
		t.Error("an expired draft was discarded")
	}
	if _, found, _ := w.AddDraft(ctx, one, withID(newTask("Too late"), ids[1]), later); found {
		t.Error("an expired draft was added")
	}
	// Nor does it count toward the limit any more.
	startDraft(t, w, one, later)
}

func TestAnAddedDraftIsATaskWithItsIDAndAddingAgainReplacesIt(t *testing.T) {
	client, table := localTable(t)
	w, s := NewWrites(client, table), New(client, table)
	ctx := context.Background()
	id := startDraft(t, w, one, started)
	at, zone := "10:00", "Europe/Berlin"
	first := withID(newTask("Its answer was lost"), id)
	first.DueTime, first.TimeZone = &at, &zone

	added, found, err := w.AddDraft(ctx, one, first, started)
	if err != nil || !found || added != first {
		t.Fatalf("added %+v, %v, %v", added, found, err)
	}
	// Adding again is a retry whose answer was lost (#427): the values go to the task. A create
	// request sends its time, so one left out is none.
	again, found, err := w.AddDraft(ctx, one, withID(newTask("Typo fixed"), id), started)
	if err != nil || !found || again.Description != "Typo fixed" || again.DueTime != nil {
		t.Fatalf("again %+v, %v, %v", again, found, err)
	}
	if mine := boardOf(t, s, one); len(mine) != 1 || mine[id].Description != "Typo fixed" {
		t.Errorf("board %+v", mine)
	}
	// It is no draft any more, so there is none to discard, and it no longer counts.
	if found, _ := w.DiscardDraft(ctx, one, id, started); found {
		t.Error("an added draft was discarded")
	}
	for range board.MaxOpenDrafts {
		startDraft(t, w, one, started)
	}
}

func TestAnotherUsersDraftOrTaskIsNotFoundAndStays(t *testing.T) {
	client, table := localTable(t)
	w, s := NewWrites(client, table), New(client, table)
	ctx := context.Background()
	theirDraft := startDraft(t, w, two, started)
	theirTask, _ := w.Create(ctx, two, newTask("Theirs"))

	if found, _ := w.DiscardDraft(ctx, one, theirDraft, started); found {
		t.Error("discarded another user's draft")
	}
	if _, found, _ := w.AddDraft(ctx, one, withID(newTask("Takeover"), theirTask.ID), started); found {
		t.Error("added over another user's task")
	}
	if found, _ := w.DiscardDraft(ctx, two, theirTask.ID, started); found {
		t.Error("discarded a task as a draft")
	}
	if len(boardOf(t, s, one)) != 0 || boardOf(t, s, two)[theirTask.ID].Description != "Theirs" {
		t.Error("a board changed")
	}
	if found, _ := w.DiscardDraft(ctx, two, theirDraft, started); !found {
		t.Error("their draft went")
	}
}

func withID(t board.Task, id int64) board.Task {
	t.ID = id
	return t
}

func TestADraftStepsOverATaskWrittenAroundTheCount(t *testing.T) {
	// As a create does: a draft taking a task's id would become a second item with it when added.
	client, table := localTable(t)
	w, s := NewWrites(client, table), New(client, table)
	put(t, client, table, map[string]any{"PK": OwnerKey(one), "SK": "TASK#00000001", "id": 1,
		"description": "Seeded", "dueDate": "2099-11-30", "importance": "LOW", "state": "TODO"})

	id := startDraft(t, w, one, started)

	if id != 2 {
		t.Errorf("draft %d; want 2", id)
	}
	if _, found, err := w.AddDraft(context.Background(), one, withID(newTask("Added"), id), started); !found || err != nil {
		t.Fatalf("add: %v, %v", found, err)
	}
	if mine := boardOf(t, s, one); mine[1].Description != "Seeded" || mine[2].Description != "Added" {
		t.Errorf("board %+v", mine)
	}
}

func TestATaskOfAUserWhoNeverStartedADraftIsAddedToAndNotDiscarded(t *testing.T) {
	// The user's META item has a task count and nothing of drafts; another user has no META item.
	client, table := localTable(t)
	w := NewWrites(client, table)
	ctx := context.Background()
	task, _ := w.Create(ctx, one, newTask("A task"))

	again, found, err := w.AddDraft(ctx, one, withID(newTask("Added again"), task.ID), started)
	if err != nil || !found || again.Description != "Added again" {
		t.Errorf("add: %+v, %v, %v", again, found, err)
	}
	if found, err := w.DiscardDraft(ctx, one, task.ID, started); found || err != nil {
		t.Errorf("discard: %v, %v", found, err)
	}
	if found, err := w.DiscardDraft(ctx, two, 1, started); found || err != nil {
		t.Errorf("discard with no META item: %v, %v", found, err)
	}
	if _, found, err := w.AddDraft(ctx, two, withID(newTask("Nothing"), 1), started); found || err != nil {
		t.Errorf("add with no META item: %v, %v", found, err)
	}
}
