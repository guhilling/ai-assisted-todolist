package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/board"
)

type fakeTasks struct {
	tasks []board.Task
	err   error
	email string
}

func (f *fakeTasks) Tasks(_ context.Context, email string) ([]board.Task, error) {
	f.email = email
	return f.tasks, f.err
}

func nobody(*http.Request) (string, bool) { return "", false }

func signedIn(*http.Request) (string, bool) { return "taskfest-test-one@example.com", true }

func sampleTasks() []board.Task {
	zone, at := "Europe/Berlin", "10:00"
	return []board.Task{
		{ID: 2, Description: "Later", DueDate: "2026-12-01", Importance: board.ImportanceHigh, State: board.StateTodo},
		{ID: 1, Description: "Sooner", DueDate: "2026-11-30", DueTime: &at, TimeZone: &zone,
			Importance: board.ImportanceLow, State: board.StateDone},
	}
}

func get(s *Server, path string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	Routes(s).ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
	return rec
}

func TestTheBoardNeedsACaller(t *testing.T) {
	rec := get(&Server{Caller: nobody, Tasks: &fakeTasks{}}, "/api/tasks")

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("got %d; want 401", rec.Code)
	}
}

func TestTheBoardIsTheCallersTasksInBoardOrder(t *testing.T) {
	fake := &fakeTasks{tasks: sampleTasks()}

	rec := get(&Server{Caller: signedIn, Tasks: fake}, "/api/tasks")

	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("got %d, %q", rec.Code, rec.Header().Get("Content-Type"))
	}
	if fake.email != "taskfest-test-one@example.com" {
		t.Errorf("asked for %q's tasks", fake.email)
	}
	var body []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body) != 2 || body[0]["id"] != 1.0 || body[1]["id"] != 2.0 {
		t.Fatalf("got %v", body)
	}
	if body[0]["dueAt"] != "2026-11-30T09:00:00Z" || body[0]["dueDate"] != "2026-11-30" {
		t.Errorf("first task %v", body[0])
	}
}

func TestNullFieldsAreSentAsNullAsQuarkusSendsThem(t *testing.T) {
	rec := get(&Server{Caller: signedIn, Tasks: &fakeTasks{tasks: sampleTasks()[:1]}}, "/api/tasks")

	var body []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"dueTime", "timeZone", "dueAt"} {
		value, present := body[0][field]
		if !present || value != nil {
			t.Errorf("%s: present %v, value %v; want null", field, present, value)
		}
	}
	if atts, ok := body[0]["attachments"].([]any); !ok || len(atts) != 0 {
		t.Errorf("attachments are always sent, as an empty list here: %v", body[0]["attachments"])
	}
}

func TestATaskWhoseDueDateDoesNotReadIsLeftOffTheBoardNotTheBoard(t *testing.T) {
	tasks := sampleTasks()
	tasks[0].DueDate = "2026-11-31"

	rec := get(&Server{Caller: signedIn, Tasks: &fakeTasks{tasks: tasks}}, "/api/tasks")

	var body []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || rec.Code != http.StatusOK {
		t.Fatalf("got %d, %v", rec.Code, err)
	}
	if len(body) != 1 || body[0]["id"] != 1.0 {
		t.Errorf("got %v; want the one readable task", body)
	}
}

func TestAStoreFailureIsAServerErrorWithoutDetail(t *testing.T) {
	rec := get(&Server{Caller: signedIn, Tasks: &fakeTasks{err: errors.New("table gone")}}, "/api/tasks")

	if rec.Code != http.StatusInternalServerError || rec.Body.Len() != 0 {
		t.Errorf("got %d %q; want an empty 500", rec.Code, rec.Body.String())
	}
}

func TestAPathIdThatIsNoNumberIsNotFound(t *testing.T) {
	rec := httptest.NewRecorder()
	Routes(&Server{Caller: signedIn, Tasks: &fakeTasks{}}).
		ServeHTTP(rec, httptest.NewRequest("DELETE", "/api/tasks/seven", nil))

	if rec.Code != http.StatusNotFound {
		t.Errorf("got %d; want 404", rec.Code)
	}
}
