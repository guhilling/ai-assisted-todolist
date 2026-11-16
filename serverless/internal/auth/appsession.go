package auth

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/identity"
)

// AppLifetime is how long an app session lasts (#281, Gunnar's decision): 30 days from its start,
// the apps' sign-in limit, however much or little it is used. It has no idle limit, so a request
// never writes it.
const AppLifetime = 30 * 24 * time.Hour

// AppSessionPrefix starts every app session token: the prefix, then 32 random bytes in base64url,
// 43 characters. Neither has a dot, so a token can never be read as a JWT, whose three parts are
// separated by dots; and a JWT starts with its header's base64url, "ey" for the "{" of its JSON,
// never with this prefix. The prefix decides how a bearer token is judged, before anything else.
const AppSessionPrefix = "taskfest_app_"

// AppSession is an app session as it starts: the token the app sends as its bearer token from
// then on, and when the session ends.
type AppSession struct {
	Token string
	Ends  time.Time
}

// IsAppSessionToken says whether a bearer token is an app session's rather than a provider's ID
// token, by its prefix alone.
func IsAppSessionToken(raw string) bool {
	return strings.HasPrefix(raw, AppSessionPrefix)
}

// idTokenClaimLifetime is how long a traded ID token is remembered as traded: a day, longer than
// any provider's ID token is valid (Google's an hour, Apple's minutes).
const idTokenClaimLifetime = 24 * time.Hour

// bearerToken is the token of a request's Authorization: Bearer header, or "" without one.
func bearerToken(r *http.Request) string {
	return bearerOf(r.Header.Get("Authorization"))
}

// bearerOf is the token of an Authorization header's Bearer scheme, or "" for any other header:
// the one place a bearer token is read, for a request's identity and its app session alike.
func bearerOf(header string) string {
	scheme, raw, ok := strings.Cut(header, " ")
	if !ok || !strings.EqualFold(scheme, "Bearer") {
		return ""
	}
	return raw
}

// StartAppSession trades the provider's ID token a request carries as its bearer token for an app
// session (#281): the app does so once after signing in natively, since an ID token from Apple's
// native sign-in cannot be renewed without the person. The ID token is verified exactly as any
// bearer request's is. Nothing else starts one: not a session cookie, nor an app session token,
// which would let a session renew itself for ever. A refusal wraps ErrRefused; any other error is
// the store's.
func (s *Service) StartAppSession(r *http.Request) (AppSession, error) {
	if !s.cfg.Enabled {
		return AppSession{}, refused("sign-in is switched off")
	}
	raw := bearerToken(r)
	if raw == "" || IsAppSessionToken(raw) {
		return AppSession{}, refused("an app session starts with a provider's ID token alone")
	}
	id, err := s.idToken(r.Context(), raw)
	if err != nil {
		return AppSession{}, err
	}
	// Once, and enforced (#630): an ID token that leaked could otherwise be traded for any number
	// of thirty-day sessions while it is valid. Remembered for a day, longer than any provider's
	// ID token lasts.
	first, err := s.store.ClaimIDToken(r.Context(), hash(raw), s.now().Add(idTokenClaimLifetime))
	if err != nil {
		return AppSession{}, err
	}
	if !first {
		return AppSession{}, refused("this ID token has been traded for an app session already")
	}
	token := AppSessionPrefix + random()
	// Whole seconds, as the store keeps them: the end the app is told is the end the backend keeps.
	now := s.now().Truncate(time.Second)
	session := Session{Identity: id, Created: now, LastSeen: now, App: true}
	if err := s.store.PutSession(r.Context(), hash(token), session, session.ends()); err != nil {
		return AppSession{}, err
	}
	slog.InfoContext(r.Context(), "signed-in", "event", "signed-in", "user", id.Subject, "provider", id.Provider,
		"session", "app")
	return AppSession{Token: token, Ends: session.ends()}, nil
}

// EndAppSession ends the app session a request's bearer token names, which is how the app signs
// out. One that has ended already, or never was, is ended all the same; a request with no app
// session token is refused (ErrRefused).
func (s *Service) EndAppSession(r *http.Request) error {
	raw := bearerToken(r)
	if !IsAppSessionToken(raw) {
		return refused("no app session token")
	}
	return s.store.DeleteSession(r.Context(), hash(raw))
}

// appSession is the person an app session token signs in, while it lasts. It is only ever read:
// with no idle limit, there is nothing to record.
func (s *Service) appSession(ctx context.Context, token string) (identity.Identity, error) {
	key := hash(token)
	stored, ok, err := s.store.GetSession(ctx, key)
	if err != nil {
		slog.ErrorContext(ctx, "reading an app session failed", "error", err)
		return identity.Identity{}, refused("the app session could not be read")
	}
	if !ok || !stored.App {
		return identity.Identity{}, refused("no such app session")
	}
	if s.now().After(stored.ends()) {
		if err := s.store.DeleteSession(ctx, key); err != nil {
			slog.WarnContext(ctx, "deleting an ended app session failed", "error", err)
		}
		return identity.Identity{}, refused("the app session has ended")
	}
	return stored.Identity, nil
}
