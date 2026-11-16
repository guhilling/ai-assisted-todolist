package api

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/auth"
)

// AppSessions starts and ends the apps' sessions (#281): internal/auth's Service, or a test's. A
// refusal wraps auth.ErrRefused and is answered 401; any other error is the store's, a 500.
type AppSessions interface {
	// StartAppSession trades the request's bearer ID token for an app session.
	StartAppSession(r *http.Request) (auth.AppSession, error)
	// EndAppSession ends the app session the request's bearer token names.
	EndAppSession(r *http.Request) error
}

// PostApiAuthAppSession starts an app session for the provider's ID token the request carries,
// which the app sends as its bearer token from then on.
func (s *Server) PostApiAuthAppSession(w http.ResponseWriter, r *http.Request) {
	if s.Apps == nil {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	started, err := s.Apps.StartAppSession(r)
	if err != nil {
		appSessionFailed(w, r, "starting an app session", err)
		return
	}
	writeJSON(r.Context(), w, http.StatusCreated, AppSessionResponse{Token: started.Token, ExpiresAt: started.Ends.UTC()})
}

// DeleteApiAuthAppSession ends the request's app session: the app signing out.
func (s *Server) DeleteApiAuthAppSession(w http.ResponseWriter, r *http.Request) {
	if s.Apps == nil {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	if err := s.Apps.EndAppSession(r); err != nil {
		appSessionFailed(w, r, "ending an app session", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// appSessionFailed answers a refusal with 401, logged as information, and anything else with 500.
func appSessionFailed(w http.ResponseWriter, r *http.Request, doing string, err error) {
	if errors.Is(err, auth.ErrRefused) {
		slog.InfoContext(r.Context(), doing+" refused", "reason", err.Error())
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	slog.ErrorContext(r.Context(), doing+" failed", "error", err)
	w.WriteHeader(http.StatusInternalServerError)
}
