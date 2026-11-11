package api

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/board"
)

// TaskWrites is where the handlers change a user's tasks and drafts: the DynamoDB store, or a
// test's. A task or draft that is not the user's is not found, never changed.
type TaskWrites interface {
	Create(ctx context.Context, email string, t board.Task) (board.Task, error)
	Replace(ctx context.Context, email string, t board.Task, keepTime bool) (board.Task, bool, error)
	Delete(ctx context.Context, email string, id int64) (bool, error)
	StartDraft(ctx context.Context, email string, now time.Time) (int64, bool, error)
	AddDraft(ctx context.Context, email string, t board.Task, now time.Time) (board.Task, bool, error)
	DiscardDraft(ctx context.Context, email string, id int64, now time.Time) (bool, error)
}

// maxReattached is how many attachments an undo may bring back: a task carries at most a few
// (D1 on #204).
const maxReattached = 10

// optional is a request field that may be left out, sent as null, or sent: what tells a left-out
// due time from a null one (#497), as JsonNullable does in the Quarkus backend.
type optional struct {
	sent  bool
	value *string
}

// UnmarshalJSON marks the field as sent, and takes its value: null, or text.
func (o *optional) UnmarshalJSON(b []byte) error {
	o.sent = true
	if string(b) == "null" {
		o.value = nil
		return nil
	}
	// Only as text: an array such as [10, 0, 30] is refused, as DueTimeDeserializer refuses it.
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		return err
	}
	o.value = &s
	return nil
}

// taskRequest is a create or an update as sent. Fields left out read as empty, which the rules
// refuse; keys the request does not know are ignored, as Quarkus ignores them.
type taskRequest struct {
	Description   *string
	DueDate       *string
	DueTime       optional
	TimeZone      optional
	Importance    string
	State         string
	AttachmentIDs []int64
}

// decode reads a request body as Jackson reads it, where encoding/json would not: a key counts
// only as written ("Description" is none), and of a key given twice the last counts.
func decode(body io.Reader) (taskRequest, error) {
	var req taskRequest
	err := readFields(body, map[string]any{
		"description": &req.Description, "dueDate": &req.DueDate,
		"dueTime": &req.DueTime, "timeZone": &req.TimeZone,
		"importance": &req.Importance, "state": &req.State, "attachmentIds": &req.AttachmentIDs,
	})
	return req, err
}

// task is the request as a task, with id, a left-out time and zone being none.
func (r taskRequest) task(id int64) board.Task {
	deref := func(s *string) string {
		if s == nil {
			return ""
		}
		return *s
	}
	return board.Task{
		ID: id, Description: deref(r.Description), DueDate: deref(r.DueDate),
		DueTime: r.DueTime.value, TimeZone: r.TimeZone.value,
		Importance: board.Importance(r.Importance), State: board.Open(board.State(r.State)),
	}
}

// read decodes a request body into a task and checks it, answering 400 when it is not one.
func read(w http.ResponseWriter, r *http.Request) (taskRequest, bool) {
	req, err := decode(r.Body)
	if err != nil {
		slog.InfoContext(r.Context(), "a task request does not read", "error", err)
		w.WriteHeader(http.StatusBadRequest)
		return req, false
	}
	if err := board.Check(req.task(0)); err != nil {
		slog.InfoContext(r.Context(), "a task request is refused", "reason", err.Error())
		w.WriteHeader(http.StatusBadRequest)
		return req, false
	}
	return req, true
}

// readNew reads a new task, a create or a draft being added, and checks what only a new task is
// held to, answering 400 when it is none: a due date today or later somewhere, and at most
// maxReattached attachments brought back.
func (s *Server) readNew(w http.ResponseWriter, r *http.Request) (taskRequest, bool) {
	req, ok := read(w, r)
	if !ok {
		return req, false
	}
	if !board.TodaySomewhere(*req.DueDate, s.now()) || len(req.AttachmentIDs) > maxReattached {
		slog.InfoContext(r.Context(), "a new task is refused", "reason", "past, or too many attachments")
		w.WriteHeader(http.StatusBadRequest)
		return req, false
	}
	return req, true
}

// now is the server's clock: Now when a test sets it, else the system's.
func (s *Server) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

// PostApiTasks creates a task for the caller, due today or later somewhere (#425): filing
// something new in the past is almost always a mistyped year.
func (s *Server) PostApiTasks(w http.ResponseWriter, r *http.Request) {
	email, ok := s.Caller(r)
	if !ok {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	req, ok := s.readNew(w, r)
	if !ok {
		return
	}
	t, err := s.Writes.Create(r.Context(), email, req.task(0))
	if err != nil {
		slog.ErrorContext(r.Context(), "creating a task failed", "error", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	// An undo re-creating a deleted task brings its attachments back with it (D3 on #204), as
	// many as it may: best effort, so a failure leaves the task without them rather than
	// answering an error for a task that was created, which a retry would create again.
	// A new task has none to read otherwise; read after an undo, a failure answers without them.
	var attached []board.Attachment
	if len(req.AttachmentIDs) > 0 {
		err := s.Attachments.Reattach(r.Context(), email, t.ID, req.AttachmentIDs, s.now())
		var all map[int64][]board.Attachment
		if err == nil {
			all, err = s.Tasks.Attachments(r.Context(), email, s.now())
		}
		if err != nil {
			slog.ErrorContext(r.Context(), "bringing attachments back failed", "task", t.ID, "error", err)
		}
		attached = all[t.ID]
	}
	s.answerWith(w, r, http.StatusCreated, t, attached)
}

// PutApiTasksId replaces the caller's task, every field of it but a due time and zone the
// request leaves out both of (#497). Its due date may be past: a task that came due yesterday
// must still be completable.
func (s *Server) PutApiTasksId(w http.ResponseWriter, r *http.Request, id int64) {
	email, ok := s.Caller(r)
	if !ok {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	req, ok := read(w, r)
	if !ok {
		return
	}
	keep := !req.DueTime.sent && !req.TimeZone.sent
	t, found, err := s.Writes.Replace(r.Context(), email, req.task(id), keep)
	if err != nil {
		slog.ErrorContext(r.Context(), "replacing a task failed", "error", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	if !found {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	s.answerTask(w, r, email, http.StatusOK, t)
}

// DeleteApiTasksId deletes the caller's task; someone else's is not found, and stays.
func (s *Server) DeleteApiTasksId(w http.ResponseWriter, r *http.Request, id int64) {
	email, ok := s.Caller(r)
	if !ok {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	found, err := s.Writes.Delete(r.Context(), email, id)
	if err != nil {
		slog.ErrorContext(r.Context(), "deleting a task failed", "error", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	if !found {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// answerTask answers with a written task and its available attachments, or 500 when it does not
// read back as one.
func (s *Server) answerTask(w http.ResponseWriter, r *http.Request, email string, status int, t board.Task) {
	attached, err := s.Tasks.Attachments(r.Context(), email, s.now())
	if err != nil {
		slog.ErrorContext(r.Context(), "reading a task's attachments failed", "task", t.ID, "error", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	s.answerWith(w, r, status, t, attached[t.ID])
}

// answerWith answers with a written task and these attachments, or 500 when it does not read back
// as one.
func (s *Server) answerWith(w http.ResponseWriter, r *http.Request, status int, t board.Task, attached []board.Attachment) {
	response, err := taskResponse(t, attached)
	if err != nil {
		slog.ErrorContext(r.Context(), "a written task does not read", "task", t.ID, "error", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	writeJSON(r.Context(), w, status, response)
}
