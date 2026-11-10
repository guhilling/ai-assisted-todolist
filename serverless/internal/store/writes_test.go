package store

import (
	"context"
	"testing"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/board"
)

const (
	one = "taskfest-test-one@example.com"
	two = "taskfest-test-two@example.com"
)

func newTask(description string) board.Task {
	return board.Task{Description: description, DueDate: "2099-11-30",
		Importance: board.ImportanceMedium, State: board.StateTodo}
}

func boardOf(t *testing.T, s *Store, email string) map[int64]board.Task {
	t.Helper()
	tasks, err := s.Tasks(context.Background(), email)
	if err != nil {
		t.Fatal(err)
	}
	byID := map[int64]board.Task{}
	for _, task := range tasks {
		byID[task.ID] = task
	}
	return byID
}

func TestACreatedTaskGetsTheUsersNextIDAndIsOnTheirBoard(t *testing.T) {
	client, table := localTable(t)
	w, s := NewWrites(client, table), New(client, table)
	ctx := context.Background()

	first, err := w.Create(ctx, one, newTask("First"))
	if err != nil {
		t.Fatal(err)
	}
	second, _ := w.Create(ctx, one, newTask("Second"))
	theirs, _ := w.Create(ctx, two, newTask("Theirs"))

	// Ids are unique per user, as the issue asks (#550); each user counts on their own.
	if first.ID != 1 || second.ID != 2 || theirs.ID != 1 {
		t.Errorf("ids %d, %d and %d", first.ID, second.ID, theirs.ID)
	}
	mine := boardOf(t, s, one)
	if len(mine) != 2 || mine[1].Description != "First" || mine[2].Description != "Second" {
		t.Errorf("board %+v", mine)
	}
}

func TestATaskIsStoredWithItsTimeAndZone(t *testing.T) {
	client, table := localTable(t)
	w, s := NewWrites(client, table), New(client, table)
	at, zone := "10:00", "Europe/Berlin"
	task := newTask("Meeting")
	task.DueTime, task.TimeZone = &at, &zone

	created, err := w.Create(context.Background(), one, task)

	if err != nil {
		t.Fatal(err)
	}
	got := boardOf(t, s, one)[created.ID]
	if got.DueTime == nil || *got.DueTime != at || got.TimeZone == nil || *got.TimeZone != zone {
		t.Errorf("stored %+v", got)
	}
}

func TestAReplacedTaskHasTheNewFields(t *testing.T) {
	client, table := localTable(t)
	w, s := NewWrites(client, table), New(client, table)
	ctx := context.Background()
	created, _ := w.Create(ctx, one, newTask("Before"))
	changed := board.Task{ID: created.ID, Description: "After", DueDate: "2099-12-01",
		Importance: board.ImportanceHigh, State: board.StateDone}

	got, found, err := w.Replace(ctx, one, changed, false)

	if err != nil || !found {
		t.Fatalf("found %v, %v", found, err)
	}
	if got != changed {
		t.Errorf("answered %+v", got)
	}
	if stored := boardOf(t, s, one)[created.ID]; stored != changed {
		t.Errorf("stored %+v", stored)
	}
}

func TestAReplaceThatKeepsTheTimeKeepsTimeAndZone(t *testing.T) {
	// An app before 1.4.0 knows neither field, and must not erase what another client set (#497).
	client, table := localTable(t)
	w := NewWrites(client, table)
	ctx := context.Background()
	at, zone := "16:45", "America/New_York"
	task := newTask("Kept")
	task.DueTime, task.TimeZone = &at, &zone
	created, _ := w.Create(ctx, one, task)
	renamed := newTask("Kept, renamed")
	renamed.ID = created.ID

	got, _, err := w.Replace(ctx, one, renamed, true)

	if err != nil {
		t.Fatal(err)
	}
	if got.Description != "Kept, renamed" || got.DueTime == nil || *got.DueTime != at ||
		got.TimeZone == nil || *got.TimeZone != zone {
		t.Errorf("got %+v", got)
	}
}

func TestAReplaceThatSendsNoTimeClearsTimeAndZone(t *testing.T) {
	client, table := localTable(t)
	w, s := NewWrites(client, table), New(client, table)
	ctx := context.Background()
	at, zone := "16:45", "Europe/Berlin"
	task := newTask("Cleared")
	task.DueTime, task.TimeZone = &at, &zone
	created, _ := w.Create(ctx, one, task)
	allDay := newTask("Cleared")
	allDay.ID = created.ID

	if _, _, err := w.Replace(ctx, one, allDay, false); err != nil {
		t.Fatal(err)
	}

	if stored := boardOf(t, s, one)[created.ID]; stored.DueTime != nil || stored.TimeZone != nil {
		t.Errorf("stored %+v", stored)
	}
}

func TestAnotherUsersTaskIsNotFoundToReplaceAndStaysAsItWas(t *testing.T) {
	client, table := localTable(t)
	w, s := NewWrites(client, table), New(client, table)
	ctx := context.Background()
	theirs, _ := w.Create(ctx, two, newTask("Theirs"))
	takeover := newTask("attempted takeover")
	takeover.ID = theirs.ID

	_, found, err := w.Replace(ctx, one, takeover, false)

	if err != nil || found {
		t.Fatalf("found %v, %v", found, err)
	}
	if len(boardOf(t, s, one)) != 0 {
		t.Error("the replace created a task for the caller")
	}
	if boardOf(t, s, two)[theirs.ID].Description != "Theirs" {
		t.Error("the other user's task changed")
	}
}

func TestADeletedTaskIsGoneAndAnotherUsersStays(t *testing.T) {
	client, table := localTable(t)
	w, s := NewWrites(client, table), New(client, table)
	ctx := context.Background()
	mine, _ := w.Create(ctx, one, newTask("Mine"))
	theirs, _ := w.Create(ctx, two, newTask("Theirs"))

	found, err := w.Delete(ctx, one, mine.ID)
	if err != nil || !found {
		t.Fatalf("found %v, %v", found, err)
	}
	if again, _ := w.Delete(ctx, one, mine.ID); again {
		t.Error("deleted twice")
	}
	// Their task has the same id as the caller's, 1: only the partition tells them apart.
	if found, _ := w.Delete(ctx, one, theirs.ID); found {
		t.Error("deleted another user's task")
	}

	if len(boardOf(t, s, one)) != 0 || len(boardOf(t, s, two)) != 1 {
		t.Errorf("boards %v and %v", boardOf(t, s, one), boardOf(t, s, two))
	}
}

func TestADeletedTasksIDIsNotGivenAgain(t *testing.T) {
	// An undo re-creates a deleted task as a new one (#204); its old id must not come back as
	// someone else's, for an app still holding it.
	client, table := localTable(t)
	w := NewWrites(client, table)
	ctx := context.Background()
	first, _ := w.Create(ctx, one, newTask("First"))
	_, _ = w.Delete(ctx, one, first.ID)

	next, _ := w.Create(ctx, one, newTask("Next"))

	if next.ID == first.ID {
		t.Errorf("id %d given twice", next.ID)
	}
}
