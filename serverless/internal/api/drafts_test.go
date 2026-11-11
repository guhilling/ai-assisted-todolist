package api

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"testing"
	"time"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/board"
)

// The Quarkus backend's DraftResourceTest, case for case, at the HTTP layer; the limit under
// requests at once, and a draft's expiry, are the store's, which internal/store's tests cover.
// DraftTaskTest is about the files on a draft, which come with the attachments (#552).

func (m *memBoard) StartDraft(_ context.Context, email string, _ time.Time) (int64, bool, error) {
	if len(m.drafts[email]) >= board.MaxOpenDrafts {
		return 0, false, nil
	}
	m.last[email]++
	if m.drafts[email] == nil {
		m.drafts[email] = map[int64]bool{}
	}
	m.drafts[email][m.last[email]] = true
	return m.last[email], true, nil
}

func (m *memBoard) AddDraft(ctx context.Context, email string, t board.Task, _ time.Time) (board.Task, bool, error) {
	if !m.drafts[email][t.ID] {
		return m.Replace(ctx, email, t, false)
	}
	delete(m.drafts[email], t.ID)
	if m.tasks[email] == nil {
		m.tasks[email] = map[int64]board.Task{}
	}
	m.tasks[email][t.ID] = t
	return t, true, nil
}

func (m *memBoard) DiscardDraft(_ context.Context, email string, id int64, _ time.Time) (bool, error) {
	if !m.drafts[email][id] {
		return false, nil
	}
	delete(m.drafts[email], id)
	return true, nil
}

func startedDraft(t *testing.T, s *Server) int64 {
	t.Helper()
	return answered(t, send(s, "POST", "/api/tasks/drafts", ""), http.StatusCreated).ID
}

func addPath(id int64) string { return fmt.Sprintf("/api/tasks/drafts/%d/add", id) }

func TestDraftsNeedACaller(t *testing.T) {
	s := serverOn(newMemBoard(), nobody)
	for _, r := range []struct{ method, path string }{
		{"POST", "/api/tasks/drafts"}, {"POST", "/api/tasks/drafts/1/add"}, {"DELETE", "/api/tasks/drafts/1"},
	} {
		if rec := send(s, r.method, r.path, taskJSON("Anonymous", "2026-11-11", "HIGH", "TODO")); rec.Code != http.StatusUnauthorized {
			t.Errorf("%s %s: %d", r.method, r.path, rec.Code)
		}
	}
}

func TestADraftIsKeptOffTheBoardAndOutOfReachAsATask(t *testing.T) {
	s := serverOn(newMemBoard(), as(alice))
	id := startedDraft(t, s)

	if rec := send(s, "GET", "/api/tasks", ""); rec.Code != http.StatusOK || rec.Body.String() != "[]" {
		t.Errorf("board %d %s", rec.Code, rec.Body)
	}
	if rec := send(s, "PUT", fmt.Sprintf("/api/tasks/%d", id), taskJSON("Edited", "2026-11-12", "LOW", "TODO")); rec.Code != http.StatusNotFound {
		t.Errorf("update: %d", rec.Code)
	}
	if rec := send(s, "DELETE", fmt.Sprintf("/api/tasks/%d", id), ""); rec.Code != http.StatusNotFound {
		t.Errorf("delete: %d", rec.Code)
	}
}

func TestADraftIsAddedOnlyWithWhatACreateTakes(t *testing.T) {
	b := newMemBoard()
	s := serverOn(b, as(alice))
	id := startedDraft(t, s)

	for name, body := range map[string]string{
		"blank":      taskJSON(" ", "2026-11-11", "MEDIUM", "TODO"),
		"past":       taskJSON("Yesterday", "2026-11-08", "MEDIUM", "TODO"),
		"empty body": "",
	} {
		if rec := send(s, "POST", addPath(id), body); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: %d", name, rec.Code)
		}
	}
	if len(b.tasks[alice]) != 0 || !b.drafts[alice][id] {
		t.Errorf("tasks %v, drafts %v", b.tasks[alice], b.drafts[alice])
	}
}

func TestADraftAddedAgainIsTheTaskItBecameWithTheNewValues(t *testing.T) {
	b := newMemBoard()
	s := serverOn(b, as(alice))
	id := startedDraft(t, s)
	answered(t, send(s, "POST", addPath(id), taskJSON("Its answer was lost", "2026-11-12", "MEDIUM", "TODO")), http.StatusCreated)

	a := answered(t, send(s, "POST", addPath(id), taskJSON("Typo fixed", "2026-11-12", "MEDIUM", "TODO")), http.StatusCreated)

	if a.ID != id || a.Description != "Typo fixed" || b.tasks[alice][id].Description != "Typo fixed" {
		t.Errorf("answered %+v, stored %+v", a, b.tasks[alice][id])
	}
}

func TestOnlyADraftIsDiscardedButATaskIsAddedAgain(t *testing.T) {
	b := newMemBoard()
	s := serverOn(b, as(alice))
	task := created(t, s, taskJSON("Already a task", "2026-11-12", "MEDIUM", "TODO"))

	// Adding a task again is what a retry does when the first answer was lost (#427).
	a := answered(t, send(s, "POST", addPath(task.ID), taskJSON("Again", "2026-11-12", "MEDIUM", "TODO")), http.StatusCreated)
	if a.Description != "Again" {
		t.Errorf("answered %+v", a)
	}
	for _, id := range []int64{task.ID, math.MaxInt64} {
		if rec := send(s, "DELETE", fmt.Sprintf("/api/tasks/drafts/%d", id), ""); rec.Code != http.StatusNotFound {
			t.Errorf("discard %d: %d", id, rec.Code)
		}
	}
	if _, ok := b.tasks[alice][task.ID]; !ok {
		t.Error("the task went")
	}
}

func TestSomeoneElsesTaskIsAddedToAsAMissingDraft(t *testing.T) {
	b := newMemBoard()
	theirs := created(t, serverOn(b, as(bob)), taskJSON("Someone else's", "2026-11-15", "MEDIUM", "TODO"))

	rec := send(serverOn(b, as(alice)), "POST", addPath(theirs.ID), taskJSON("Attempted takeover", "2026-11-12", "MEDIUM", "TODO"))

	if rec.Code != http.StatusNotFound || b.tasks[bob][theirs.ID].Description != "Someone else's" {
		t.Errorf("got %d, theirs %+v", rec.Code, b.tasks[bob][theirs.ID])
	}
}

func TestASixthOpenDraftIsRefusedAndOneGoneMakesRoom(t *testing.T) {
	s := serverOn(newMemBoard(), as(alice))
	first, second := startedDraft(t, s), startedDraft(t, s)
	for range board.MaxOpenDrafts - 2 {
		startedDraft(t, s)
	}

	// Refused as an attachment beyond its limits is.
	if rec := send(s, "POST", "/api/tasks/drafts", ""); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("a sixth: %d", rec.Code)
	}
	if rec := send(s, "DELETE", fmt.Sprintf("/api/tasks/drafts/%d", first), ""); rec.Code != http.StatusNoContent {
		t.Fatalf("discard: %d", rec.Code)
	}
	startedDraft(t, s)
	answered(t, send(s, "POST", addPath(second), taskJSON("No draft any more", "2026-11-12", "MEDIUM", "TODO")), http.StatusCreated)
	startedDraft(t, s)
	if rec := send(s, "POST", "/api/tasks/drafts", ""); rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("a sixth again: %d", rec.Code)
	}
}

func TestTheDraftsMatchTheContract(t *testing.T) {
	c := loadContract(t)
	s := serverOn(newMemBoard(), as(alice))

	rec := send(s, "POST", "/api/tasks/drafts", "")
	c.checkResponse(t, "POST", "/api/tasks/drafts", rec.Code, rec.Body.Bytes())
	rec = send(s, "POST", "/api/tasks/drafts/1/add", taskJSON("Meeting", "2099-11-30", "HIGH", "TODO",
		"dueTime", "10:00", "timeZone", "Europe/Berlin"))
	c.checkResponse(t, "POST", "/api/tasks/drafts/{id}/add", rec.Code, rec.Body.Bytes())
	send(s, "POST", "/api/tasks/drafts", "")
	rec = send(s, "DELETE", "/api/tasks/drafts/2", "")
	if rec.Code != http.StatusNoContent || rec.Header().Get("Content-Type") != "" {
		t.Errorf("discard: %d, %q", rec.Code, rec.Header().Get("Content-Type"))
	}
}
