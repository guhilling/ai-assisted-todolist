package api

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/board"
)

// TasksSource is where the handlers get a user's tasks from: the DynamoDB store, or a test's.
type TasksSource interface {
	Tasks(ctx context.Context, email string) ([]board.Task, error)
}

// Caller says who sent a request: the verified email that identifies them, or ok false when
// nobody is signed in. Sign-in (#549) provides the real one; until then cmd/api reads the claims
// API Gateway's JWT authorizer passes on, as the spike did.
type Caller func(r *http.Request) (email string, ok bool)

// Server implements every route of the contract. The ones not ported yet answer 501
// (unported.go); each story of the port (#547) replaces some of them.
type Server struct {
	unported
	Tasks  TasksSource
	Caller Caller
}

// Routes returns the routes of the contract, served by s.
func Routes(s *Server) http.Handler {
	return HandlerWithOptions(s, StdHTTPServerOptions{
		ErrorHandlerFunc: func(w http.ResponseWriter, _ *http.Request, _ error) {
			// A path id that is no number: no such resource, which is what JAX-RS answers too,
			// and the only answer the contract declares for it.
			w.WriteHeader(http.StatusNotFound)
		},
	})
}

// GetApiTasks answers the board: the caller's tasks in board order.
func (s *Server) GetApiTasks(w http.ResponseWriter, r *http.Request) {
	email, ok := s.Caller(r)
	if !ok {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	tasks, err := s.Tasks.Tasks(r.Context(), email)
	if err != nil {
		slog.ErrorContext(r.Context(), "reading the board failed", "error", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	board.Sort(tasks)

	out := make([]TaskResponse, 0, len(tasks))
	for _, t := range tasks {
		response, err := taskResponse(t)
		if err != nil {
			// Only the backend writes tasks, so this is a bug or a hand-edited item: logged, and
			// left off the board rather than taking the caller's other tasks with it.
			slog.ErrorContext(r.Context(), "a stored task does not read", "task", t.ID, "error", err)
			continue
		}
		out = append(out, response)
	}
	writeJSON(r.Context(), w, http.StatusOK, out)
}

func taskResponse(t board.Task) (TaskResponse, error) {
	due, err := time.Parse(time.DateOnly, t.DueDate)
	if err != nil {
		return TaskResponse{}, err
	}
	at, err := board.DueAt(t)
	if err != nil {
		// As the spike: a zone the binary no longer knows leaves the moment out, not the task.
		slog.Error("a stored due time does not parse", "task", t.ID, "error", err)
	}
	attachments := []AttachmentResponse{}
	return TaskResponse{
		Id: t.ID, Description: t.Description, DueDate: openapi_types.Date{Time: due},
		DueTime: t.DueTime, TimeZone: t.TimeZone, DueAt: at,
		Importance: TaskImportance(t.Importance), State: TaskState(t.State),
		Attachments: &attachments,
	}, nil
}

func writeJSON(ctx context.Context, w http.ResponseWriter, status int, v any) {
	body, err := json.Marshal(v)
	if err != nil {
		slog.ErrorContext(ctx, "writing a response failed", "error", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}
