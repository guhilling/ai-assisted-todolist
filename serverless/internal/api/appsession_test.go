package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/auth"
)

// fakeApps is app sessions for the route tests: what starting or ending one answers.
type fakeApps struct {
	started auth.AppSession
	err     error
	called  string
}

func (f *fakeApps) StartAppSession(*http.Request) (auth.AppSession, error) {
	f.called = "start"
	return f.started, f.err
}

func (f *fakeApps) EndAppSession(*http.Request) error {
	f.called = "end"
	return f.err
}

func TestStartingAnAppSessionAnswersItsTokenAndEnd(t *testing.T) {
	c := loadContract(t)
	ends := time.Date(2026, 12, 16, 9, 30, 0, 0, time.UTC)
	token := "taskfest_app_q8Jx2mJ0bZ8tQ1n4Yc7d5v3s6K9wF2hL0aR1uE4oP7i"
	apps := &fakeApps{started: auth.AppSession{Token: token, Ends: ends}}

	rec := serve(&Server{Apps: apps}, "POST", "/api/auth/app-session")

	if rec.Code != http.StatusCreated || apps.called != "start" {
		t.Fatalf("got %d, %q", rec.Code, apps.called)
	}
	c.checkResponse(t, "POST", "/api/auth/app-session", rec.Code, rec.Body.Bytes())
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["token"] != token || body["expiresAt"] != "2026-12-16T09:30:00Z" {
		t.Errorf("got %v", body)
	}
}

func TestEndingAnAppSessionAnswersNoContent(t *testing.T) {
	c := loadContract(t)
	apps := &fakeApps{}

	rec := serve(&Server{Apps: apps}, "DELETE", "/api/auth/app-session")

	if rec.Code != http.StatusNoContent || apps.called != "end" {
		t.Fatalf("got %d, %q", rec.Code, apps.called)
	}
	c.checkResponse(t, "DELETE", "/api/auth/app-session", rec.Code, rec.Body.Bytes())
}

func TestARefusedAppSessionIs401AndAFailedOne500(t *testing.T) {
	c := loadContract(t)
	refused := fmt.Errorf("%w: no ID token", auth.ErrRefused)
	for _, method := range []string{"POST", "DELETE"} {
		for err, want := range map[error]int{refused: http.StatusUnauthorized,
			errors.New("table gone"): http.StatusInternalServerError} {
			rec := serve(&Server{Apps: &fakeApps{err: err}}, method, "/api/auth/app-session")
			if rec.Code != want || rec.Body.Len() != 0 {
				t.Errorf("%s with %v: got %d %q; want an empty %d", method, err, rec.Code, rec.Body.String(), want)
			}
			if want == http.StatusUnauthorized {
				c.checkResponse(t, method, "/api/auth/app-session", rec.Code, rec.Body.Bytes())
			}
		}
	}
}
