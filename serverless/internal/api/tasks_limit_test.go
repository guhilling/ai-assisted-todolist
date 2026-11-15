package api

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/board"
)

// fullBoard is a board whose user has the most tasks they may have (#607): every create and every
// draft added is refused, as the store refuses them.
type fullBoard struct{ *memBoard }

func (fullBoard) Create(context.Context, string, board.Task) (board.Task, error) {
	return board.Task{}, board.ErrTooManyTasks
}

func (fullBoard) AddDraft(context.Context, string, board.Task, time.Time) (board.Task, bool, error) {
	return board.Task{}, false, board.ErrTooManyTasks
}

func TestATaskBeyondTheLimitIsRefusedAsADraftBeyondItsIs(t *testing.T) {
	s := serverOn(newMemBoard(), as(alice))
	s.Writes = fullBoard{newMemBoard()}

	// 422, as a sixth draft and an attachment beyond its limits are: the request is understood and
	// refused, not a server error the app would retry.
	if rec := send(s, "POST", "/api/tasks", taskJSON("One too many", "2026-11-20", "MEDIUM", "TODO")); rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("create: %d", rec.Code)
	}
	if rec := send(s, "POST", addPath(7), taskJSON("A draft too many", "2026-11-20", "MEDIUM", "TODO")); rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("add a draft: %d", rec.Code)
	}
}
