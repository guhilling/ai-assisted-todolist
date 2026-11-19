package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/auth"
	"github.com/guhilling/ai-assisted-todolist/serverless/internal/identity"
)

func (f *fakeSignIn) EndSession(w http.ResponseWriter, _ *http.Request) {
	f.called = "end-session"
	http.SetCookie(w, &http.Cookie{Name: "taskfest_session", MaxAge: -1})
}

func (f *fakeSignIn) RevocationForDeletion(_ *http.Request, code string) (auth.Revocation, error) {
	f.revoked = &code
	return f.revocation, f.revokeErr
}

func (f *fakeSignIn) ConfirmDeletionAtApple(_ http.ResponseWriter, _ *http.Request, email string) (string, error) {
	f.confirmedFor = email
	return f.confirmAt, f.confirmErr
}

// fakeDeletion records the steps of a deletion in order, and fails the one named in fail.
type fakeDeletion struct {
	steps  []string
	fail   string
	marked map[string]bool
	// unreadable fails reading whether an account is being deleted.
	unreadable bool
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
	if f.unreadable {
		return false, errors.New("read failed")
	}
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

func TestARequestWhoseAccountCannotBeReadIsNotServed(t *testing.T) {
	d := &fakeDeletion{unreadable: true}
	caller := Settled(as("person@example.com"), d)

	if _, ok := caller(httptest.NewRequest("GET", "/api/tasks", nil)); ok {
		t.Error("a request was served without knowing whether its account is being deleted")
	}
}

func TestWhoIsSignedInFinishesADeletionLeftHalfWayToo(t *testing.T) {
	d := &fakeDeletion{marked: map[string]bool{"person@example.com": true}, fail: "settle"}
	who := identity.Identity{Email: "person@example.com"}
	s := &Server{SignIn: &fakeSignIn{who: &who}, Accounts: d}

	rec := serve(s, "GET", "/api/auth/me")

	if rec.Code != http.StatusUnauthorized || strings.Join(d.steps, ", ") != "settle person@example.com" {
		t.Errorf("got %d after %v; want 401 after settling", rec.Code, d.steps)
	}
}

// deleteWith deletes the account with body, as the app sends Apple's confirmation (#635).
func deleteWith(s *Server, body string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	r := httptest.NewRequest("DELETE", "/api/account", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	Routes(s).ServeHTTP(rec, r)
	return rec
}

func TestDeletingAnAccountSignedInWithAppleRevokesOnceTheDeletionCountsAsDone(t *testing.T) {
	d := &fakeDeletion{}
	s, signIn := deletingServer(d, true)
	signIn.revocation = func(context.Context) error { return d.step("revoke", "at Apple") }

	rec := deleteWith(s, `{"appleAuthorizationCode":"code-1"}`)

	if rec.Code != http.StatusNoContent || signIn.revoked == nil || *signIn.revoked != "code-1" {
		t.Fatalf("got %d, revoked with %v; want 204 after revoking with code-1", rec.Code, signIn.revoked)
	}
	if got := strings.Join(d.steps, ", "); got != "record person@example.com, mark person@example.com, revoke at Apple, finish person@example.com" {
		t.Errorf("steps %q; want Apple revoked once the account is marked", got)
	}
}

func TestADeletionThatFailsRevokesNothing(t *testing.T) {
	d := &fakeDeletion{fail: "mark"}
	s, signIn := deletingServer(d, true)
	revoked := false
	signIn.revocation = func(context.Context) error { revoked = true; return nil }

	if rec := deleteWith(s, `{"appleAuthorizationCode":"code-1"}`); rec.Code != http.StatusInternalServerError || revoked {
		t.Errorf("got %d, revoked %v; want 500 and Apple left as it was", rec.Code, revoked)
	}
}

func TestDeletingWithoutABodyHandsOnNoConfirmation(t *testing.T) {
	s, signIn := deletingServer(&fakeDeletion{}, true)

	if rec := serve(s, "DELETE", "/api/account"); rec.Code != http.StatusNoContent {
		t.Fatalf("got %d; want 204", rec.Code)
	}
	if signIn.revoked == nil || *signIn.revoked != "" {
		t.Errorf("revoked with %v; want asked with no code", signIn.revoked)
	}
}

func TestAnAppleAccountIsNotDeletedWithoutAppleConfirmingIt(t *testing.T) {
	d := &fakeDeletion{}
	s, signIn := deletingServer(d, true)
	signIn.revokeErr = auth.ErrAppleConfirmationNeeded

	rec := serve(s, "DELETE", "/api/account")

	if rec.Code != http.StatusPreconditionRequired {
		t.Errorf("got %d; want 428", rec.Code)
	}
	if len(d.steps) != 0 || signIn.called != "" {
		t.Errorf("steps %v, %q; want nothing deleted or ended", d.steps, signIn.called)
	}
}

func TestAnAppleAccountIsDeletedEvenWhenAppleCannotRevoke(t *testing.T) {
	d := &fakeDeletion{}
	s, signIn := deletingServer(d, true)
	signIn.revocation = func(context.Context) error {
		return errors.New("revoke at Apple: the revocation endpoint answered 503")
	}

	if rec := deleteWith(s, `{"appleAuthorizationCode":"code-1"}`); rec.Code != http.StatusNoContent || len(d.steps) != 3 {
		t.Errorf("got %d, steps %v; want 204 and the account deleted", rec.Code, d.steps)
	}
}

func TestADeletionWhoseBodyIsNoConfirmationIsRefused(t *testing.T) {
	for _, body := range []string{
		`{"appleAuthorizationCode":`,
		`{"appleAuthorizationCode":"code-1"} and more`,
		`{"appleAuthorizationCode":"` + strings.Repeat("c", 4097) + `"}`,
	} {
		d := &fakeDeletion{}
		s, signIn := deletingServer(d, true)

		rec := deleteWith(s, body)

		if rec.Code != http.StatusBadRequest || len(d.steps) != 0 || signIn.revoked != nil {
			t.Errorf("%.40s: got %d, steps %v; want 400 and nothing done", body, rec.Code, d.steps)
		}
	}
}

func TestADeletionWhoseBodyOrCodeIsNullIsRefused(t *testing.T) {
	for _, body := range []string{`null`, ` null `, `{"appleAuthorizationCode":null}`} {
		d := &fakeDeletion{}
		s, signIn := deletingServer(d, true)

		rec := deleteWith(s, body)

		if rec.Code != http.StatusBadRequest || len(d.steps) != 0 || signIn.revoked != nil {
			t.Errorf("%s: got %d, steps %v; want 400 and nothing done", body, rec.Code, d.steps)
		}
	}
}

func TestADeletionWithAnEmptyRequestHandsOnNoConfirmation(t *testing.T) {
	s, signIn := deletingServer(&fakeDeletion{}, true)

	if rec := deleteWith(s, `{}`); rec.Code != http.StatusNoContent {
		t.Fatalf("got %d; want 204", rec.Code)
	}
	if signIn.revoked == nil || *signIn.revoked != "" {
		t.Errorf("revoked with %v; want asked with no code", signIn.revoked)
	}
}

func TestADeletionWhoseRequestCannotBeIdentifiedAgainDoesNotHappen(t *testing.T) {
	d := &fakeDeletion{}
	s, signIn := deletingServer(d, true)
	signIn.revokeErr = auth.ErrNotIdentified

	rec := serve(s, "DELETE", "/api/account")

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("got %d; want 401", rec.Code)
	}
	if len(d.steps) != 0 || signIn.called != "" {
		t.Errorf("steps %v, %q; want nothing deleted or ended", d.steps, signIn.called)
	}
}

func TestTheWebsiteIsSentToApplesSignInToConfirmDeletingAnAppleAccount(t *testing.T) {
	c := loadContract(t)
	d := &fakeDeletion{}
	s, signIn := deletingServer(d, true)
	signIn.revokeErr = auth.ErrAppleConfirmationNeeded
	signIn.confirmAt = "https://appleid.apple.com/auth/authorize?client_id=services-id"

	rec := serve(s, "DELETE", "/api/account")

	if rec.Code != http.StatusPreconditionRequired || signIn.confirmedFor != "person@example.com" {
		t.Fatalf("got %d, confirmed for %q; want 428 for the caller's account", rec.Code, signIn.confirmedFor)
	}
	c.checkResponse(t, "DELETE", "/api/account", rec.Code, rec.Body.Bytes())
	var body AccountDeletionConfirmation
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || body.AppleSignInUrl != signIn.confirmAt {
		t.Errorf("body %s, %v; want Apple's sign-in", rec.Body, err)
	}
	if len(d.steps) != 0 || signIn.called != "" {
		t.Errorf("steps %v, %q; want nothing deleted or ended", d.steps, signIn.called)
	}
}

func TestAConfirmationAtAppleThatCannotStartDeletesNothing(t *testing.T) {
	for err, want := range map[error]int{
		auth.ErrNotIdentified:                  http.StatusUnauthorized,
		errors.New("storing a sign-in failed"): http.StatusInternalServerError,
	} {
		d := &fakeDeletion{}
		s, signIn := deletingServer(d, true)
		signIn.revokeErr = auth.ErrAppleConfirmationNeeded
		signIn.confirmErr = err

		rec := serve(s, "DELETE", "/api/account")

		if rec.Code != want || len(d.steps) != 0 {
			t.Errorf("%v: got %d, steps %v; want %d and nothing deleted", err, rec.Code, d.steps, want)
		}
	}
}

func TestAnAccountAppleConfirmedAtTheCallbackIsDeletedLikeAnyOther(t *testing.T) {
	d := &fakeDeletion{}
	s, _ := deletingServer(d, true)

	err := s.DeleteAccount(context.Background(), "person@example.com",
		func(context.Context) error { return d.step("revoke", "at Apple") })

	if got := strings.Join(d.steps, ", "); err != nil ||
		got != "record person@example.com, mark person@example.com, revoke at Apple, finish person@example.com" {
		t.Errorf("steps %q, %v; want recorded, marked, revoked and finished", got, err)
	}
}

func TestAnAccountAppleConfirmedThatCannotBeMarkedIsNotDeleted(t *testing.T) {
	d := &fakeDeletion{fail: "mark"}
	s, _ := deletingServer(d, true)
	revoked := false

	err := s.DeleteAccount(context.Background(), "person@example.com",
		func(context.Context) error { revoked = true; return nil })

	if err == nil || revoked {
		t.Errorf("err %v, revoked %v; want an error and Apple left as it was", err, revoked)
	}
}
