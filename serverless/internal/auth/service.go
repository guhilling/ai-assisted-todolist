package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"golang.org/x/oauth2"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/identity"
)

// How long a session lasts (#549, Gunnar's decision): eight hours without a request, as with the
// Quarkus backend, and never more than seven days after signing in, since it is not renewed with
// the provider. A sign-in under way may take ten minutes.
const (
	IdleLifetime     = 8 * time.Hour
	AbsoluteLifetime = 7 * 24 * time.Hour
	SignInLifetime   = 10 * time.Minute
	// touchAfter keeps a busy session from writing on every request: its last request is
	// recorded at most this often, which is all an eight-hour idle limit needs.
	touchAfter = 5 * time.Minute
)

// The cookies. Both carry a random value whose hash keys the stored item, so the table holds no
// value that would let anyone in.
const (
	SessionCookie = "taskfest_session"
	SignInCookie  = "taskfest_signin"
)

// Session is a signed-in website session as stored.
type Session struct {
	identity.Identity
	Created, LastSeen time.Time
}

// PendingSignIn is a sign-in under way: what the callback needs to finish it.
type PendingSignIn struct {
	Provider, Verifier, Nonce string
}

// Store keeps sessions and sign-ins under way, keyed by a hash of their cookie's value. Each item
// expires by itself at the time given (internal/store: DynamoDB's TTL), and the service also
// checks the times on reading, since TTL deletes late.
type Store interface {
	PutSession(ctx context.Context, key string, s Session, expires time.Time) error
	GetSession(ctx context.Context, key string) (Session, bool, error)
	TouchSession(ctx context.Context, key string, lastSeen, expires time.Time) error
	DeleteSession(ctx context.Context, key string) error
	PutPendingSignIn(ctx context.Context, key string, p PendingSignIn, expires time.Time) error
	// TakePendingSignIn returns and deletes it in one step, so a callback can be used once.
	TakePendingSignIn(ctx context.Context, key string) (PendingSignIn, bool, error)
}

// Avatars finds a picture for an address when the provider sent none: Gravatar, in the backend.
type Avatars interface {
	Lookup(ctx context.Context, email string) string
}

// Service is sign-in for one deployment.
type Service struct {
	cfg       Config
	store     Store
	avatars   Avatars
	discovery *discovery
	now       func() time.Time
}

// New returns sign-in for cfg, keeping sessions in store.
func New(cfg Config, store Store, avatars Avatars) *Service {
	return &Service{cfg: cfg, store: store, avatars: avatars, discovery: &discovery{}, now: time.Now}
}

// Config returns the configuration the service runs with.
func (s *Service) Config() Config { return s.cfg }

// Identify says who sent a request. A request with an Authorization header is an app's and is
// judged by its bearer ID token alone, never by a cookie; any other is the website's and is judged
// by its session cookie (doc/authentication.md: every tenant is hybrid).
func (s *Service) Identify(r *http.Request) (identity.Identity, bool) {
	if !s.cfg.Enabled {
		return identity.Identity{}, false
	}
	if header := r.Header.Get("Authorization"); header != "" {
		id, err := s.bearer(r.Context(), header)
		if err != nil {
			slog.InfoContext(r.Context(), "bearer token refused", "reason", err.Error())
			return identity.Identity{}, false
		}
		return id, true
	}
	cookie, err := r.Cookie(SessionCookie)
	if err != nil || cookie.Value == "" {
		return identity.Identity{}, false
	}
	return s.session(r.Context(), cookie.Value)
}

func (s *Service) bearer(ctx context.Context, header string) (identity.Identity, error) {
	scheme, raw, ok := strings.Cut(header, " ")
	if !ok || !strings.EqualFold(scheme, "Bearer") || raw == "" {
		return identity.Identity{}, refused("not a bearer token")
	}
	issuer, ok := issuerOf(raw)
	if !ok {
		return identity.Identity{}, refused("not a JWT")
	}
	err := refused("no provider issues %q", issuer)
	// Two providers may share an issuer, as two clients of one Cognito pool would; the token is
	// whichever's it was issued to.
	for _, p := range s.cfg.Providers {
		if p.Issuer != issuer || p.ClientID == "" {
			continue
		}
		var id identity.Identity
		if id, _, err = verifyIDToken(ctx, s.discovery, p, raw, p.audiences()); err == nil {
			return id, nil
		}
	}
	return identity.Identity{}, err
}

// WithPicture fills in a picture from Gravatar where the provider sent none. Only /api/auth/me
// shows one, so only it asks, rather than every request an app sends.
func (s *Service) WithPicture(ctx context.Context, id identity.Identity) identity.Identity {
	if id.Picture == "" {
		id.Picture = s.avatars.Lookup(ctx, id.Email)
	}
	return id
}

func (s *Service) session(ctx context.Context, token string) (identity.Identity, bool) {
	key := hash(token)
	stored, ok, err := s.store.GetSession(ctx, key)
	if err != nil {
		slog.ErrorContext(ctx, "reading a session failed", "error", err)
		return identity.Identity{}, false
	}
	if !ok {
		return identity.Identity{}, false
	}
	now := s.now()
	if now.After(stored.LastSeen.Add(IdleLifetime)) || now.After(stored.Created.Add(AbsoluteLifetime)) {
		if err := s.store.DeleteSession(ctx, key); err != nil {
			slog.WarnContext(ctx, "deleting an ended session failed", "error", err)
		}
		return identity.Identity{}, false
	}
	if now.Sub(stored.LastSeen) > touchAfter {
		if err := s.store.TouchSession(ctx, key, now, expiry(stored.Created, now)); err != nil {
			slog.WarnContext(ctx, "recording a session's request failed", "error", err)
		}
	}
	return stored.Identity, true
}

// expiry is when a session created then and last used now ends, unless used again.
func expiry(created, lastSeen time.Time) time.Time {
	idle, absolute := lastSeen.Add(IdleLifetime), created.Add(AbsoluteLifetime)
	if idle.Before(absolute) {
		return idle
	}
	return absolute
}

// usable returns the provider that signs in at the path naming id ("" for the main one's path),
// or false where there is none to sign in with, which the caller answers with a 404.
func (s *Service) usable(id string) (Provider, bool) {
	if !s.cfg.Enabled {
		return Provider{}, false
	}
	p, ok := s.cfg.main()
	if id != "" {
		p, ok = s.cfg.provider(id)
		ok = ok && !p.Main
	}
	return p, ok && p.Usable()
}

// Login starts sign-in with the provider id names ("" for the main one), or, for a browser that
// is signed in already, sends it back to the app.
func (s *Service) Login(w http.ResponseWriter, r *http.Request, id string) {
	p, ok := s.usable(id)
	if !ok {
		http.NotFound(w, r)
		return
	}
	if _, signedIn := s.Identify(r); signedIn {
		s.backToTheApp(w, r)
		return
	}
	conf, err := s.oauth(r, p)
	if err != nil {
		slog.ErrorContext(r.Context(), "starting sign-in failed", "provider", p.ID, "error", err)
		w.WriteHeader(http.StatusBadGateway)
		return
	}
	state, nonce, verifier := random(), random(), oauth2.GenerateVerifier()
	err = s.store.PutPendingSignIn(r.Context(), hash(state),
		PendingSignIn{Provider: p.ID, Verifier: verifier, Nonce: nonce}, s.now().Add(SignInLifetime))
	if err != nil {
		slog.ErrorContext(r.Context(), "storing a sign-in failed", "error", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	http.SetCookie(w, s.cookie(SignInCookie, state, SignInLifetime))
	http.Redirect(w, r, conf.AuthCodeURL(state, oauth2.S256ChallengeOption(verifier),
		oauth2.SetAuthURLParam("nonce", nonce)), http.StatusFound)
}

// Callback finishes sign-in with the provider id names ("" for the main one): the state must be
// the browser's own, the code is exchanged, the ID token checked like a bearer token but for this
// client alone and this nonce, and a session begins.
func (s *Service) Callback(w http.ResponseWriter, r *http.Request, id string) {
	p, ok := s.usable(id)
	if !ok {
		http.NotFound(w, r)
		return
	}
	ident, err := s.finish(r, p)
	if err != nil {
		level := slog.LevelError
		if errors.Is(err, ErrRefused) {
			level = slog.LevelInfo
		}
		slog.Log(r.Context(), level, "sign-in refused", "provider", p.ID, "reason", err.Error())
		// Back to the app, signed out, which offers sign-in again: a second tab's sign-in, a
		// callback used twice or a cancelled sign-in would otherwise end on a blank page.
		http.SetCookie(w, s.cookie(SignInCookie, "", -1))
		s.backToTheApp(w, r)
		return
	}
	token := random()
	now := s.now()
	if err := s.store.PutSession(r.Context(), hash(token), Session{Identity: ident, Created: now, LastSeen: now},
		expiry(now, now)); err != nil {
		slog.ErrorContext(r.Context(), "storing a session failed", "error", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	slog.InfoContext(r.Context(), "signed-in", "event", "signed-in", "user", ident.Subject, "provider", ident.Provider)
	http.SetCookie(w, s.cookie(SessionCookie, token, AbsoluteLifetime))
	http.SetCookie(w, s.cookie(SignInCookie, "", -1))
	s.backToTheApp(w, r)
}

func (s *Service) finish(r *http.Request, p Provider) (identity.Identity, error) {
	q := r.URL.Query()
	if e := q.Get("error"); e != "" {
		return identity.Identity{}, refused("the provider answered %q", e)
	}
	state := q.Get("state")
	cookie, err := r.Cookie(SignInCookie)
	if err != nil || state == "" || subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(state)) != 1 {
		return identity.Identity{}, refused("the state is not this browser's")
	}
	pending, ok, err := s.store.TakePendingSignIn(r.Context(), hash(state))
	if err != nil {
		return identity.Identity{}, err
	}
	if !ok || pending.Provider != p.ID {
		return identity.Identity{}, refused("no sign-in under way with %s for this state", p.ID)
	}
	conf, err := s.oauth(r, p)
	if err != nil {
		return identity.Identity{}, err
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	tokens, err := conf.Exchange(ctx, q.Get("code"), oauth2.VerifierOption(pending.Verifier))
	if err != nil {
		return identity.Identity{}, refused("exchanging the code: %v", err)
	}
	raw, _ := tokens.Extra("id_token").(string)
	if raw == "" {
		return identity.Identity{}, refused("the provider sent no ID token")
	}
	ident, c, err := verifyIDToken(ctx, s.discovery, p, raw, []string{p.ClientID})
	if err != nil {
		return identity.Identity{}, err
	}
	if subtle.ConstantTimeCompare([]byte(c.Nonce), []byte(pending.Nonce)) != 1 {
		return identity.Identity{}, refused("the ID token's nonce is not this sign-in's")
	}
	// No Gravatar here: /api/auth/me asks, through WithPicture, so the return from the provider
	// never waits for it.
	return ident, nil
}

// Logout ends the browser's session, on the server and in the browser, and sends it back to the
// app. Like the Quarkus backend's, it is no RP-initiated logout: the provider's own session stays.
func (s *Service) Logout(w http.ResponseWriter, r *http.Request) {
	s.EndSession(w, r)
	http.Redirect(w, r, s.cfg.PostLoginRedirect, http.StatusSeeOther)
}

// EndSession ends this browser's session, on the server and in its cookies, and writes nothing
// else: signing out, and deleting the account (#553), which answers on its own.
func (s *Service) EndSession(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(SessionCookie); err == nil && cookie.Value != "" {
		if err := s.store.DeleteSession(r.Context(), hash(cookie.Value)); err != nil {
			slog.ErrorContext(r.Context(), "deleting a session failed", "error", err)
		}
	}
	http.SetCookie(w, s.cookie(SessionCookie, "", -1))
	s.clearQuarkusCookies(w, r)
}

// backToTheApp redirects to the app, clearing what the Quarkus backend's sessions left behind.
func (s *Service) backToTheApp(w http.ResponseWriter, r *http.Request) {
	s.clearQuarkusCookies(w, r)
	http.Redirect(w, r, s.cfg.PostLoginRedirect, http.StatusSeeOther)
}

// clearQuarkusCookies clears what the Quarkus backend's sessions (q_session, its chunks, q_auth)
// left behind, so nothing from before the move lingers.
func (s *Service) clearQuarkusCookies(w http.ResponseWriter, r *http.Request) {
	for _, c := range r.Cookies() {
		if strings.HasPrefix(c.Name, "q_session") || strings.HasPrefix(c.Name, "q_auth") {
			http.SetCookie(w, s.cookie(c.Name, "", -1))
		}
	}
}

func (s *Service) oauth(r *http.Request, p Provider) (*oauth2.Config, error) {
	op, err := s.discovery.provider(r.Context(), p.Issuer)
	if err != nil {
		return nil, err
	}
	return &oauth2.Config{
		ClientID: p.ClientID, ClientSecret: p.ClientSecret, Endpoint: op.Endpoint(),
		RedirectURL: s.origin(r) + p.CallbackPath(),
		Scopes:      []string{"openid", "email", "profile"},
	}, nil
}

// origin is the site the browser sees, for the redirect URI the provider sends it back to.
func (s *Service) origin(r *http.Request) string {
	if s.cfg.PublicOrigin != "" {
		return s.cfg.PublicOrigin
	}
	scheme := "http"
	if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}

func (s *Service) cookie(name, value string, maxAge time.Duration) *http.Cookie {
	c := &http.Cookie{Name: name, Value: value, Path: "/", HttpOnly: true, Secure: s.cfg.SecureCookies,
		SameSite: http.SameSiteLaxMode, MaxAge: int(maxAge.Seconds())}
	if maxAge < 0 {
		c.MaxAge = -1
	}
	return c
}

// random is 32 random bytes, URL-safe: a session id, a state or a nonce.
func random() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b) // never fails (crypto/rand)
	return base64.RawURLEncoding.EncodeToString(b)
}

// hash keys a stored item by a cookie's value without storing the value.
func hash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
