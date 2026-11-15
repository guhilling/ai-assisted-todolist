package store

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/board"
)

func TestTheTaskBeyondTheLimitIsRefusedAndOneDeletedMakesRoom(t *testing.T) {
	// The limit on tasks (#607), Gunnar's choice for the website open to everyone: without one,
	// one account could grow the table at will.
	client, table := localTable(t)
	w := NewWrites(client, table)
	ctx := context.Background()
	draft := startDraft(t, w, one, started)
	first, err := w.Create(ctx, one, newTask("Task"))
	if err != nil {
		t.Fatal(err)
	}
	// The rest as bare keys, which is all the count reads: far quicker than 499 creates, each of
	// which counts the board first. Their ids are far above any the META item gives out.
	for i := range board.MaxTasksPerUser - 1 {
		put(t, client, table, map[string]any{"PK": OwnerKey(one), "SK": fmt.Sprintf("TASK#%08d", 1_000_000+i)})
	}

	if _, err := w.Create(ctx, one, newTask("One too many")); !errors.Is(err, board.ErrTooManyTasks) {
		t.Fatalf("a task beyond the limit: %v", err)
	}
	// A draft becoming a task counts as a create.
	if _, _, err := w.AddDraft(ctx, one, withID(newTask("A draft too many"), draft), started); !errors.Is(err, board.ErrTooManyTasks) {
		t.Fatalf("a draft added beyond the limit: %v", err)
	}
	// An id that is neither a task nor an open draft is not found, however full the board.
	if _, found, err := w.AddDraft(ctx, one, withID(newTask("Never a draft"), 999), started); found || err != nil {
		t.Fatalf("an unknown id on a full board: %v, %v", found, err)
	}
	// Another user counts on their own.
	if _, err := w.Create(ctx, two, newTask("Someone else's")); err != nil {
		t.Fatalf("another user: %v", err)
	}

	if found, err := w.Delete(ctx, one, first.ID); !found || err != nil {
		t.Fatalf("delete: %v, %v", found, err)
	}
	if _, found, err := w.AddDraft(ctx, one, withID(newTask("The draft, now there is room"), draft), started); !found || err != nil {
		t.Fatalf("the draft after a delete: %v, %v", found, err)
	}
	// Adding it again, as a retry whose answer was lost does (#427), only sets its values: no
	// task more, so the full board does not refuse it.
	if _, found, err := w.AddDraft(ctx, one, withID(newTask("The draft, retried"), draft), started); !found || err != nil {
		t.Fatalf("the add retried at the limit: %v, %v", found, err)
	}
	if _, err := w.Create(ctx, one, newTask("Full again")); !errors.Is(err, board.ErrTooManyTasks) {
		t.Errorf("full again: %v", err)
	}
}
