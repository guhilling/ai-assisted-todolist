package api

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func (f *fakeSignIn) EndSession(w http.ResponseWriter, _ *http.Request) {
	f.called = "end-session"
	http.SetCookie(w, &http.Cookie{Name: "taskfest_session", MaxAge: -1})
}

// fakeDeletion records the steps of a deletion in order, and fails the one named in fail.
type fakeDeletion struct {
	steps  []string
	fail   string
	marked map[string]bool
}

func (f *fakeDeletion) step(name, email string) error {
	f.steps = append(f.steps, name+" "+email)
	if f.fail == name {
		return errors.New(name + " failed")
	}
	return nil
}

func (f *fakeDeletion) RecordDeletion(_ context.Context, email string) error {
	return f.step("record", email)
}

func (f *fakeDeletion) ForgetDeletion(_ context.Context, email string) error {
	return f.step("forget", email)
}

func (f *fakeDeletion) Mark(_ context.Context, email string) error {
	return f.step("mark", email)
}

func (f *fakeDeletion) Finish(_ context.Context, email string) error {
	return f.step("finish", email)
}

func (f *fakeDeletion) Settle(_ context.Context, email string) (bool, error) {
	if f.marked[email] {
		return true, f.step("settle", email)
	}
	return false, nil
}

func deletingServer(d *fakeDeletion, records bool) (*Server, *fakeSignIn) {
	signIn := &fakeSignIn{}
	s := &Server{Caller: as("person@example.com"), Accounts: d, SignIn: signIn}
	if records {
		s.Records = d
	}
	return s, signIn
}

func TestDeletingTheAccountRecordsItFirstThenMarksAndFinishesIt(t *testing.T) {
	d := &fakeDeletion{}
	s, signIn := deletingServer(d, true)

	rec := serve(s, "DELETE", "/api/account")

	if rec.Code != http.StatusNoContent {
		t.Fatalf("got %d; want 204", rec.Code)
	}
	if got := strings.Join(d.steps, ", "); got != "record person@example.com, mark person@example.com, finish person@example.com" {
		t.Errorf("steps: %s", got)
	}
	if signIn.called != "end-session" || !strings.Contains(rec.Header().Get("Set-Cookie"), "taskfest_session=") {
		t.Errorf("this browser's session was not ended: %q", rec.Header().Get("Set-Cookie"))
	}
}

func TestADeletionThatCannotBeRecordedDoesNotHappen(t *testing.T) {
	d := &fakeDeletion{fail: "record"}
	s, signIn := deletingServer(d, true)

	rec := serve(s, "DELETE", "/api/account")

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("got %d; want 500", rec.Code)
	}
	if got := strings.Join(d.steps, ", "); got != "record person@example.com" {
		t.Errorf("steps: %s", got)
	}
	if signIn.called != "" {
		t.Error("the session was ended for a deletion that did not happen")
	}
}

func TestADeletionThatCannotBeMarkedTakesItsRecordBack(t *testing.T) {
	d := &fakeDeletion{fail: "mark"}
	s, _ := deletingServer(d, true)

	rec := serve(s, "DELETE", "/api/account")

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("got %d; want 500", rec.Code)
	}
	if got := strings.Join(d.steps, ", "); got != "record person@example.com, mark person@example.com, forget person@example.com" {
		t.Errorf("steps: %s", got)
	}
}

func TestADeletionThatStopsAfterTheMarkCountsAsDoneAndKeepsItsRecord(t *testing.T) {
	d := &fakeDeletion{fail: "finish"}
	s, signIn := deletingServer(d, true)

	rec := serve(s, "DELETE", "/api/account")

	if rec.Code != http.StatusNoContent {
		t.Errorf("got %d; want 204", rec.Code)
	}
	if got := strings.Join(d.steps, ", "); strings.Contains(got, "forget") {
		t.Errorf("the record was taken back: %s", got)
	}
	if signIn.called != "end-session" {
		t.Error("this browser's session was not ended")
	}
}

func TestWithoutRecordsTheAccountIsDeletedWithoutOne(t *testing.T) {
	d := &fakeDeletion{}
	s, _ := deletingServer(d, false)

	rec := serve(s, "DELETE", "/api/account")

	if rec.Code != http.StatusNoContent {
		t.Errorf("got %d; want 204", rec.Code)
	}
	if got := strings.Join(d.steps, ", "); got != "mark person@example.com, finish person@example.com" {
		t.Errorf("steps: %s", got)
	}
}

func TestDeletingAnAccountNeedsSomeoneSignedIn(t *testing.T) {
	d := &fakeDeletion{}
	s, _ := deletingServer(d, true)
	s.Caller = func(*http.Request) (string, bool) { return "", false }

	rec := serve(s, "DELETE", "/api/account")

	if rec.Code != http.StatusUnauthorized || len(d.steps) != 0 {
		t.Errorf("got %d after %v; want 401 and nothing done", rec.Code, d.steps)
	}
}

func TestACallersDeletionLeftHalfWayIsFinishedBeforeTheRequestIsServed(t *testing.T) {
	d := &fakeDeletion{marked: map[string]bool{"person@example.com": true}}
	caller := Settled(as("person@example.com"), d)

	email, ok := caller(httptest.NewRequest("GET", "/api/tasks", nil))

	if !ok || email != "person@example.com" {
		t.Errorf("got %q, %v", email, ok)
	}
	if got := strings.Join(d.steps, ", "); got != "settle person@example.com" {
		t.Errorf("steps: %s", got)
	}
}

func TestNobodySignedInIsNotSettled(t *testing.T) {
	d := &fakeDeletion{marked: map[string]bool{"": true}}
	caller := Settled(func(*http.Request) (string, bool) { return "", false }, d)

	if _, ok := caller(httptest.NewRequest("GET", "/api/tasks", nil)); ok || len(d.steps) != 0 {
		t.Errorf("signed in %v after %v", ok, d.steps)
	}
}

func TestARequestWhoseDeletionWasJustFinishedIsAskedWhoItIsAgain(t *testing.T) {
	d := &fakeDeletion{marked: map[string]bool{"person@example.com": true}}
	asked := 0
	// The session the request came with went with the account.
	caller := Settled(func(*http.Request) (string, bool) {
		asked++
		return "person@example.com", asked == 1
	}, d)

	if _, ok := caller(httptest.NewRequest("GET", "/api/tasks", nil)); ok {
		t.Error("a request was served on the session its account's deletion ended")
	}
}

func TestARequestWhoseDeletionCannotBeFinishedIsNotServed(t *testing.T) {
	d := &fakeDeletion{marked: map[string]bool{"person@example.com": true}, fail: "settle"}
	caller := Settled(as("person@example.com"), d)

	if _, ok := caller(httptest.NewRequest("GET", "/api/tasks", nil)); ok {
		t.Error("a request was served on what is left of a deleted account")
	}
}
