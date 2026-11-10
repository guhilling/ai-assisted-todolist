package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/board"
)

// The Quarkus backend's TaskResourceTest and DueTimeTest, case for case, at the HTTP layer and
// against an in-memory board; what the store does with DynamoDB is internal/store's tests'.
// DueTimeTest's two database cases have no counterpart: DynamoDB has no constraints, so the rules
// are the backend's alone, which internal/board's tests cover.

const (
	alice = "taskfest-test-one@example.com"
	bob   = "taskfest-test-two@example.com"
)

// memBoard is every user's tasks in memory, with ids counted per user as the store counts them.
type memBoard struct {
	tasks map[string]map[int64]board.Task
	last  map[string]int64
}

func newMemBoard() *memBoard {
	return &memBoard{tasks: map[string]map[int64]board.Task{}, last: map[string]int64{}}
}

func (m *memBoard) Tasks(_ context.Context, email string) ([]board.Task, error) {
	var out []board.Task
	for _, t := range m.tasks[email] {
		out = append(out, t)
	}
	return out, nil
}

func (m *memBoard) Create(_ context.Context, email string, t board.Task) (board.Task, error) {
	m.last[email]++
	t.ID = m.last[email]
	if m.tasks[email] == nil {
		m.tasks[email] = map[int64]board.Task{}
	}
	m.tasks[email][t.ID] = t
	return t, nil
}

func (m *memBoard) Replace(_ context.Context, email string, t board.Task, keepTime bool) (board.Task, bool, error) {
	old, ok := m.tasks[email][t.ID]
	if !ok {
		return board.Task{}, false, nil
	}
	if keepTime {
		t.DueTime, t.TimeZone = old.DueTime, old.TimeZone
	}
	m.tasks[email][t.ID] = t
	return t, true, nil
}

func (m *memBoard) Delete(_ context.Context, email string, id int64) (bool, error) {
	if _, ok := m.tasks[email][id]; !ok {
		return false, nil
	}
	delete(m.tasks[email], id)
	return true, nil
}

func as(email string) Caller {
	return func(*http.Request) (string, bool) { return email, true }
}

// noon is the clock the tests run on: 2026-11-10 at noon UTC.
func noon() time.Time { return time.Date(2026, 11, 10, 12, 0, 0, 0, time.UTC) }

func serverOn(b *memBoard, caller Caller) *Server {
	return &Server{Caller: caller, Tasks: b, Writes: b, Now: noon}
}

func send(s *Server, method, path, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	Routes(s).ServeHTTP(rec, req)
	return rec
}

// taskJSON is a request body: these fields, plus any of dueTime and timeZone in extra.
func taskJSON(description, due, importance, state string, extra ...string) string {
	fields := map[string]any{"description": description, "dueDate": due}
	if importance != "" {
		fields["importance"] = importance
	}
	if state != "" {
		fields["state"] = state
	}
	for i := 0; i+1 < len(extra); i += 2 {
		if extra[i+1] == "null" {
			fields[extra[i]] = nil
		} else {
			fields[extra[i]] = extra[i+1]
		}
	}
	b, _ := json.Marshal(fields)
	return string(b)
}

type answer struct {
	ID          int64   `json:"id"`
	Description string  `json:"description"`
	DueDate     string  `json:"dueDate"`
	DueTime     *string `json:"dueTime"`
	TimeZone    *string `json:"timeZone"`
	DueAt       *string `json:"dueAt"`
	Importance  string  `json:"importance"`
	State       string  `json:"state"`
}

func answered(t *testing.T, rec *httptest.ResponseRecorder, status int) answer {
	t.Helper()
	if rec.Code != status {
		t.Fatalf("got %d (%s); want %d", rec.Code, rec.Body, status)
	}
	var a answer
	if err := json.Unmarshal(rec.Body.Bytes(), &a); err != nil {
		t.Fatal(err)
	}
	return a
}

func created(t *testing.T, s *Server, body string) answer {
	t.Helper()
	return answered(t, send(s, "POST", "/api/tasks", body), http.StatusCreated)
}

func str(p *string) string {
	if p == nil {
		return "<null>"
	}
	return *p
}

// TaskResourceTest.

func TestWritesNeedACaller(t *testing.T) {
	s := serverOn(newMemBoard(), nobody)
	for _, r := range []struct{ method, path string }{
		{"POST", "/api/tasks"}, {"PUT", "/api/tasks/1"}, {"DELETE", "/api/tasks/1"},
	} {
		if rec := send(s, r.method, r.path, taskJSON("Anonymous job", "2026-11-11", "HIGH", "TODO")); rec.Code != http.StatusUnauthorized {
			t.Errorf("%s %s: %d", r.method, r.path, rec.Code)
		}
	}
}

func TestACreatedTaskIsTheCallersAndOnTheirBoard(t *testing.T) {
	b := newMemBoard()
	s := serverOn(b, as(alice))

	a := created(t, s, taskJSON("Write the report", "2026-11-13", "HIGH", "TODO"))

	if a.Description != "Write the report" || a.Importance != "HIGH" || a.ID == 0 {
		t.Errorf("answered %+v", a)
	}
	if got := b.tasks[alice][a.ID]; got.Description != "Write the report" {
		t.Errorf("stored %+v", got)
	}
	if len(b.tasks[bob]) != 0 {
		t.Error("stored for someone else")
	}
}

func TestOtherUsersTasksAreNotListed(t *testing.T) {
	b := newMemBoard()
	created(t, serverOn(b, as(bob)), taskJSON("Bob's", "2026-11-15", "MEDIUM", "TODO"))
	created(t, serverOn(b, as(alice)), taskJSON("Alice's", "2026-11-12", "MEDIUM", "TODO"))

	rec := send(serverOn(b, as(alice)), "GET", "/api/tasks", "")

	if !strings.Contains(rec.Body.String(), "Alice's") || strings.Contains(rec.Body.String(), "Bob's") {
		t.Errorf("board %s", rec.Body)
	}
}

func TestUpdatingAnotherUsersTaskIsNotFound(t *testing.T) {
	b := newMemBoard()
	theirs := created(t, serverOn(b, as(bob)), taskJSON("Bob's", "2026-11-15", "MEDIUM", "TODO"))

	rec := send(serverOn(b, as(alice)), "PUT", "/api/tasks/1", taskJSON("attempted takeover", "2026-11-11", "LOW", "DONE"))

	if rec.Code != http.StatusNotFound {
		t.Errorf("got %d", rec.Code)
	}
	if b.tasks[bob][theirs.ID].Description != "Bob's" {
		t.Error("their task changed")
	}
}

func TestDeletingOwnTaskTakesItOffTheBoard(t *testing.T) {
	b := newMemBoard()
	s := serverOn(b, as(alice))
	a := created(t, s, taskJSON("Delete me", "2026-11-14", "LOW", "TODO"))

	rec := send(s, "DELETE", "/api/tasks/1", "")

	if rec.Code != http.StatusNoContent || rec.Body.Len() != 0 {
		t.Errorf("got %d, %q", rec.Code, rec.Body)
	}
	if _, left := b.tasks[alice][a.ID]; left {
		t.Error("still there")
	}
}

func TestDeletingAnotherUsersTaskIsNotFoundAndLeavesItWhereItWas(t *testing.T) {
	b := newMemBoard()
	theirs := created(t, serverOn(b, as(bob)), taskJSON("Bob's", "2026-11-15", "MEDIUM", "TODO"))

	rec := send(serverOn(b, as(alice)), "DELETE", "/api/tasks/1", "")

	if rec.Code != http.StatusNotFound {
		t.Errorf("got %d", rec.Code)
	}
	// The status alone would also come from a route that does not exist.
	if _, ok := b.tasks[bob][theirs.ID]; !ok {
		t.Error("their task is gone")
	}
}

func TestUpdatingOwnTaskReplacesIt(t *testing.T) {
	b := newMemBoard()
	s := serverOn(b, as(alice))
	created(t, s, taskJSON("Before", "2026-11-14", "LOW", "TODO"))

	a := answered(t, send(s, "PUT", "/api/tasks/1", taskJSON("After", "2026-11-16", "HIGH", "DONE")), http.StatusOK)

	if a.ID != 1 || a.Description != "After" || a.DueDate != "2026-11-16" || a.Importance != "HIGH" || a.State != "DONE" {
		t.Errorf("answered %+v", a)
	}
	if b.tasks[alice][1].State != board.StateDone {
		t.Errorf("stored %+v", b.tasks[alice][1])
	}
}

func TestATaskWhoseDueDateHasPassedCanStillBeCompleted(t *testing.T) {
	// The date rule is for creating a task, not changing one: a task that came due yesterday
	// must still be completable.
	b := newMemBoard()
	s := serverOn(b, as(alice))
	created(t, s, taskJSON("Overdue", "2026-11-13", "HIGH", "TODO"))

	a := answered(t, send(s, "PUT", "/api/tasks/1", taskJSON("Overdue", "2026-11-08", "HIGH", "DONE")), http.StatusOK)

	if a.State != "DONE" || a.DueDate != "2026-11-08" {
		t.Errorf("answered %+v", a)
	}
}

func TestAnInvalidTaskIsRefusedAndNotStored(t *testing.T) {
	for reason, body := range map[string]string{
		"a blank description":                taskJSON("", "2026-11-11", "MEDIUM", "TODO"),
		"a description past the column size": taskJSON(strings.Repeat("x", 256), "2026-11-11", "MEDIUM", "TODO"),
		// Two days ago: yesterday may still be someone's today (#425).
		"a due date in the past": taskJSON("Yesterday's job", "2026-11-08", "MEDIUM", "TODO"),
		"no importance":          taskJSON("Unrated job", "2026-11-11", "", "TODO"),
		"no state":               taskJSON("Stateless job", "2026-11-11", "MEDIUM", ""),
		"an unknown importance":  taskJSON("Odd job", "2026-11-11", "URGENT", "TODO"),
		"too many attachments": `{"description":"Undone","dueDate":"2026-11-11","importance":"LOW",` +
			`"state":"TODO","attachmentIds":[1,2,3,4,5,6,7,8,9,10,11]}`,
	} {
		b := newMemBoard()

		rec := send(serverOn(b, as(alice)), "POST", "/api/tasks", body)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: got %d", reason, rec.Code)
		}
		if len(b.tasks[alice]) != 0 {
			t.Errorf("%s: stored", reason)
		}
	}
}

func TestADueDateStillTodaySomewhereBehindUTCIsAccepted(t *testing.T) {
	// At 06:00 UTC it is still yesterday in UTC-12 (#425).
	s := serverOn(newMemBoard(), as(alice))
	s.Now = func() time.Time { return time.Date(2026, 11, 10, 6, 0, 0, 0, time.UTC) }

	a := created(t, s, taskJSON("Due today in New York", "2026-11-09", "MEDIUM", "TODO"))

	if a.DueDate != "2026-11-09" {
		t.Errorf("answered %+v", a)
	}
}

func TestAnEmptyBodyIsRefusedAsInvalidNotAFailure(t *testing.T) {
	s := serverOn(newMemBoard(), as(alice))
	created(t, s, taskJSON("Empty-bodied", "2026-11-11", "LOW", "TODO"))

	for _, r := range []struct{ method, path string }{{"POST", "/api/tasks"}, {"PUT", "/api/tasks/1"}} {
		if rec := send(s, r.method, r.path, ""); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: got %d", r.method, rec.Code)
		}
	}
}

func TestWorkingIsAcceptedAndStoredAsOpen(t *testing.T) {
	// Apps from before #334 can still send it (until #345).
	b := newMemBoard()

	a := created(t, serverOn(b, as(alice)), taskJSON("In progress", "2026-11-11", "LOW", "WORKING"))

	if a.State != "TODO" || b.tasks[alice][a.ID].State != board.StateTodo {
		t.Errorf("answered %+v", a)
	}
}

// DueTimeTest.

func TestATaskWithoutATimeIsAllDay(t *testing.T) {
	a := created(t, serverOn(newMemBoard(), as(alice)), taskJSON("All day", "2099-11-30", "MEDIUM", "TODO"))

	if a.DueDate != "2099-11-30" || a.DueTime != nil || a.TimeZone != nil || a.DueAt != nil {
		t.Errorf("answered %+v", a)
	}
}

func TestAFloatingTimeHasNoMoment(t *testing.T) {
	a := created(t, serverOn(newMemBoard(), as(alice)),
		taskJSON("Take the pills", "2099-11-30", "MEDIUM", "TODO", "dueTime", "08:00"))

	if str(a.DueTime) != "08:00" || a.TimeZone != nil || a.DueAt != nil {
		t.Errorf("answered %+v", a)
	}
}

func TestAZonedTimeIsAnsweredWithItsMoment(t *testing.T) {
	a := created(t, serverOn(newMemBoard(), as(alice)),
		taskJSON("Meeting in Berlin", "2099-11-30", "MEDIUM", "TODO", "dueTime", "10:00", "timeZone", "Europe/Berlin"))

	if str(a.DueTime) != "10:00" || str(a.TimeZone) != "Europe/Berlin" || str(a.DueAt) != "2099-11-30T09:00:00Z" {
		t.Errorf("answered %+v", a)
	}
}

func TestAZonedTimeInAGapMovesLaterAndInAnOverlapTakesTheEarlierMoment(t *testing.T) {
	s := serverOn(newMemBoard(), as(alice))

	gap := created(t, s, taskJSON("In the gap", "2099-03-29", "MEDIUM", "TODO", "dueTime", "02:30", "timeZone", "Europe/Berlin"))
	overlap := created(t, s, taskJSON("In the overlap", "2099-10-25", "MEDIUM", "TODO", "dueTime", "02:30", "timeZone", "Europe/Berlin"))

	if str(gap.DueTime) != "02:30" || str(gap.DueAt) != "2099-03-29T01:30:00Z" {
		t.Errorf("gap %+v", gap)
	}
	if str(overlap.DueAt) != "2099-10-25T00:30:00Z" {
		t.Errorf("overlap %+v", overlap)
	}
}

func TestAnUpdateChangesAndClearsATime(t *testing.T) {
	s := serverOn(newMemBoard(), as(alice))
	created(t, s, taskJSON("Moved around", "2099-11-30", "MEDIUM", "TODO", "dueTime", "08:00"))

	a := answered(t, send(s, "PUT", "/api/tasks/1",
		taskJSON("Moved around", "2099-11-30", "MEDIUM", "TODO", "dueTime", "16:45", "timeZone", "America/New_York")), http.StatusOK)
	if str(a.DueTime) != "16:45" || str(a.TimeZone) != "America/New_York" || str(a.DueAt) != "2099-11-30T21:45:00Z" {
		t.Errorf("changed %+v", a)
	}

	// null for both makes it all day again.
	a = answered(t, send(s, "PUT", "/api/tasks/1",
		taskJSON("Moved around", "2099-11-30", "MEDIUM", "TODO", "dueTime", "null", "timeZone", "null")), http.StatusOK)
	if a.DueTime != nil || a.TimeZone != nil || a.DueAt != nil {
		t.Errorf("cleared %+v", a)
	}
}

func TestAnUpdateThatLeavesOutTimeAndZoneKeepsThem(t *testing.T) {
	// An app before 1.4.0 knows neither field, and must not erase what another client set (#497).
	s := serverOn(newMemBoard(), as(alice))
	created(t, s, taskJSON("Kept", "2099-11-30", "MEDIUM", "TODO", "dueTime", "16:45", "timeZone", "America/New_York"))

	a := answered(t, send(s, "PUT", "/api/tasks/1", taskJSON("Kept renamed", "2099-12-01", "MEDIUM", "TODO")), http.StatusOK)

	if a.Description != "Kept renamed" || str(a.DueTime) != "16:45" || str(a.TimeZone) != "America/New_York" ||
		str(a.DueAt) != "2099-12-01T21:45:00Z" {
		t.Errorf("answered %+v", a)
	}
}

func TestAnUpdateThatLeavesOutOnlyTheZoneMakesTheTimeFloating(t *testing.T) {
	// The two travel as a pair (Gunnar on #497): only both left out keep what is stored.
	s := serverOn(newMemBoard(), as(alice))
	created(t, s, taskJSON("Floating now", "2099-11-30", "MEDIUM", "TODO", "dueTime", "16:45", "timeZone", "Europe/Berlin"))

	a := answered(t, send(s, "PUT", "/api/tasks/1",
		taskJSON("Floating now", "2099-11-30", "MEDIUM", "TODO", "dueTime", "11:00")), http.StatusOK)

	if str(a.DueTime) != "11:00" || a.TimeZone != nil || a.DueAt != nil {
		t.Errorf("answered %+v", a)
	}
}

func TestRefusedTimesAndZones(t *testing.T) {
	array := `{"description":"As an array","dueDate":"2099-11-30","importance":"MEDIUM","state":"TODO","dueTime":[10,0,30]}`
	for reason, body := range map[string]string{
		// A left-out time is no time, so the zone has none to belong to, whatever is stored.
		"only a zone":               taskJSON("Zone alone", "2099-11-30", "MEDIUM", "TODO", "timeZone", "America/New_York"),
		"a zone with a null time":   taskJSON("Zone only", "2099-11-30", "MEDIUM", "TODO", "dueTime", "null", "timeZone", "Europe/Berlin"),
		"a zone nobody knows":       taskJSON("Atlantis", "2099-11-30", "MEDIUM", "TODO", "dueTime", "10:00", "timeZone", "Europe/Atlantis"),
		"a zone too long":           taskJSON("Long", "2099-11-30", "MEDIUM", "TODO", "dueTime", "10:00", "timeZone", "Europe/"+strings.Repeat("A", 60)),
		"a time finer than minutes": taskJSON("To the second", "2099-11-30", "MEDIUM", "TODO", "dueTime", "10:00:30"),
		"twenty-four o'clock":       taskJSON("Midnight", "2099-11-30", "MEDIUM", "TODO", "dueTime", "24:00", "timeZone", "Europe/Berlin"),
		"a time other than as text": array,
	} {
		s := serverOn(newMemBoard(), as(alice))
		created(t, s, taskJSON("There", "2099-11-30", "MEDIUM", "TODO", "dueTime", "16:45", "timeZone", "Europe/Berlin"))

		if rec := send(s, "POST", "/api/tasks", body); rec.Code != http.StatusBadRequest {
			t.Errorf("create with %s: got %d", reason, rec.Code)
		}
		if rec := send(s, "PUT", "/api/tasks/1", body); rec.Code != http.StatusBadRequest {
			t.Errorf("update with %s: got %d", reason, rec.Code)
		}
	}
}

// The answers match the contract.

func TestTheWritesMatchTheContract(t *testing.T) {
	c := loadContract(t)
	s := serverOn(newMemBoard(), as(alice))
	body := taskJSON("Meeting", "2099-11-30", "HIGH", "TODO", "dueTime", "10:00", "timeZone", "Europe/Berlin")

	rec := send(s, "POST", "/api/tasks", body)
	c.checkResponse(t, "POST", "/api/tasks", rec.Code, rec.Body.Bytes())
	rec = send(s, "PUT", "/api/tasks/1", body)
	c.checkResponse(t, "PUT", "/api/tasks/{id}", rec.Code, rec.Body.Bytes())
	rec = send(s, "DELETE", "/api/tasks/1", "")
	if rec.Code != http.StatusNoContent {
		t.Errorf("delete: %d", rec.Code)
	}
	if rec.Header().Get("Content-Type") != "" {
		t.Errorf("a 204 with a content type: %q", rec.Header().Get("Content-Type"))
	}
}

func TestTheLastOfARepeatedKeyCounts(t *testing.T) {
	// Jackson takes the last occurrence, so a zone sent and then nulled is no zone.
	s := serverOn(newMemBoard(), as(alice))

	a := created(t, s, `{"description":"Twice","dueDate":"2099-11-30","importance":"LOW","state":"TODO",`+
		`"dueTime":"10:00","timeZone":"Europe/Berlin","timeZone":null}`)

	if str(a.DueTime) != "10:00" || a.TimeZone != nil || a.DueAt != nil {
		t.Errorf("answered %+v", a)
	}
}

func TestKeysAreMatchedExactlyAsJacksonMatchesThem(t *testing.T) {
	// "Description" is a key nobody knows, so the description is missing, and Quarkus says 400.
	s := serverOn(newMemBoard(), as(alice))

	rec := send(s, "POST", "/api/tasks", `{"Description":"x","dueDate":"2099-11-30","importance":"HIGH","state":"TODO"}`)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("got %d", rec.Code)
	}
}

func TestAKeyInAnotherCaseDoesNotCountAsSent(t *testing.T) {
	// "DUETIME" is unknown, so time and zone are both left out and kept (#497).
	s := serverOn(newMemBoard(), as(alice))
	created(t, s, taskJSON("Kept", "2099-11-30", "MEDIUM", "TODO", "dueTime", "16:45", "timeZone", "Europe/Berlin"))

	a := answered(t, send(s, "PUT", "/api/tasks/1",
		`{"description":"Kept","dueDate":"2099-11-30","importance":"MEDIUM","state":"TODO","DUETIME":null}`), http.StatusOK)

	if str(a.DueTime) != "16:45" || str(a.TimeZone) != "Europe/Berlin" {
		t.Errorf("answered %+v", a)
	}
}

func TestASignedOutRequestWithAnIDThatIsNoNumberIsUnauthorised(t *testing.T) {
	// @Authenticated answers before the path is read: 401, which sends the client to sign in.
	for _, method := range []string{"PUT", "DELETE"} {
		if rec := send(serverOn(newMemBoard(), nobody), method, "/api/tasks/abc", ""); rec.Code != http.StatusUnauthorized {
			t.Errorf("%s: got %d", method, rec.Code)
		}
	}
}
