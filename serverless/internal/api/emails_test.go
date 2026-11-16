package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/identity"
)

// fakeEmails keys every account by the email lower-cased, unless legacy names it as sent, and
// fails when broken.
type fakeEmails struct {
	legacy map[string]bool
	broken bool
	asked  []string
}

func (f *fakeEmails) AccountEmail(_ context.Context, email string) (string, error) {
	f.asked = append(f.asked, email)
	if f.broken {
		return "", errors.New("read failed")
	}
	if f.legacy[email] {
		return email, nil
	}
	return strings.ToLower(email), nil
}

func TestTheCallerIsTheEmailTheirAccountIsKeyedBy(t *testing.T) {
	emails := &fakeEmails{legacy: map[string]bool{"Old@Example.com": true}}
	for sent, want := range map[string]string{"Gunnar@Example.com": "gunnar@example.com",
		"Old@Example.com": "Old@Example.com"} {
		email, ok := Keyed(as(sent), emails)(httptest.NewRequest("GET", "/api/tasks", nil))
		if !ok || email != want {
			t.Errorf("%s: got %q, %v; want %q", sent, email, ok, want)
		}
	}
}

func TestNobodySignedInIsNotKeyed(t *testing.T) {
	emails := &fakeEmails{}
	if _, ok := Keyed(func(*http.Request) (string, bool) { return "", false }, emails)(
		httptest.NewRequest("GET", "/api/tasks", nil)); ok || len(emails.asked) != 0 {
		t.Errorf("signed in %v after asking %v", ok, emails.asked)
	}
}

func TestARequestWhoseAccountCannotBeKeyedIsNotServed(t *testing.T) {
	if _, ok := Keyed(as("Gunnar@Example.com"), &fakeEmails{broken: true})(
		httptest.NewRequest("GET", "/api/tasks", nil)); ok {
		t.Error("a request was served without knowing whose account it is")
	}
}

func TestDeletingTheAccountOfAnEmailWithCapitalsDeletesTheAccountItIsKeyedBy(t *testing.T) {
	// The record is named by the same email as the partition, so that the replay finds it.
	d := &fakeDeletion{}
	s, _ := deletingServer(d, true)
	s.Caller = Keyed(as("Gunnar@Example.com"), &fakeEmails{})

	if rec := serve(s, "DELETE", "/api/account"); rec.Code != http.StatusNoContent {
		t.Fatalf("got %d; want 204", rec.Code)
	}
	if got := strings.Join(d.steps, ", "); got !=
		"record gunnar@example.com, mark gunnar@example.com, finish gunnar@example.com" {
		t.Errorf("steps: %s", got)
	}
}

func TestWhoIsSignedInSettlesTheAccountTheirEmailIsKeyedByAndShowsTheEmailAsSent(t *testing.T) {
	d := &fakeDeletion{marked: map[string]bool{"Old@Example.com": true}}
	who := identity.Identity{Email: "Old@Example.com"}
	s := &Server{SignIn: &fakeSignIn{who: &who}, Accounts: d,
		Emails: &fakeEmails{legacy: map[string]bool{"Old@Example.com": true}}}

	rec := serve(s, "GET", "/api/auth/me")

	if got := strings.Join(d.steps, ", "); got != "settle Old@Example.com" {
		t.Errorf("steps: %s", got)
	}
	var me CurrentUserResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &me); err != nil || string(me.Email) != "Old@Example.com" {
		t.Errorf("got %d %s, %v", rec.Code, rec.Body, err)
	}
}

func TestWhoIsSignedInIsNotShownWhenTheirAccountCannotBeKeyed(t *testing.T) {
	who := identity.Identity{Email: "Gunnar@Example.com"}
	s := &Server{SignIn: &fakeSignIn{who: &who}, Accounts: &fakeDeletion{}, Emails: &fakeEmails{broken: true}}

	if rec := serve(s, "GET", "/api/auth/me"); rec.Code != http.StatusUnauthorized {
		t.Errorf("got %d; want 401", rec.Code)
	}
}
