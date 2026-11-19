package auth

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/identity"
)

// AppleIssuer is Sign in with Apple's issuer. Apple asks an app that offers it to revoke its
// authorization when an account is deleted (#635); no other provider is asked anything then.
const AppleIssuer = "https://appleid.apple.com"

// ErrAppleConfirmationNeeded refuses deleting an account signed in with Apple without Apple's
// confirmation: the authorization code its sheet issues when the person signs in with it once more.
var ErrAppleConfirmationNeeded = errors.New("deleting an account signed in with Apple needs Apple's confirmation")

// ErrNotIdentified refuses a deletion whose request can no longer be identified: its session
// ended, or could not be read, after the caller was. Without knowing the provider, an account
// signed in with Apple could otherwise go without Apple's confirmation (CodeRabbit on #637).
var ErrNotIdentified = errors.New("the deletion's request can no longer be identified")

// appleBudget bounds everything a revocation asks of Apple together: its metadata, the exchange
// and the revocation. The app waits for the deletion's answer, and the function has a deletion to
// finish after it, all within API Gateway's 29 seconds.
const appleBudget = 8 * time.Second

// Revocation revokes a provider's authorization once an account's deletion counts as done; it
// returns whatever stopped it, which the caller logs.
type Revocation func(ctx context.Context) error

// RevocationForDeletion says what the deletion of the request's account asks of Apple (#635), so
// that TaskFest is no longer listed under the person's Apple ID once the account is gone. A
// request signed in with any other provider is asked for nothing: no revocation, and nil. One
// signed in with Apple returns ErrAppleConfirmationNeeded without a code, the authorization code
// Apple's sheet issued when the person signed in with Apple once more, to confirm. A request
// that cannot be identified returns ErrNotIdentified.
//
// With a code, the revocation it returns exchanges the code for Apple's tokens and revokes the
// refresh token, once the deletion counts as done: a deletion that fails before then leaves
// Apple's authorization as it was. Nothing is asked of Apple until then, and nothing is kept, as
// nothing of Apple's is (doc/decisions/authentication.md). The revocation fails, revoking nothing,
// when the code confirms another Apple ID than the session's.
//
// Only the app's code is exchanged here, as the app's bundle id, the first of Apple's audiences
// besides the website's client: the website confirms at Apple's sign-in, ConfirmDeletionAtApple,
// which comes back to the callback.
func (s *Service) RevocationForDeletion(r *http.Request, code string) (Revocation, error) {
	id, ok := s.Identify(r)
	if !ok {
		return nil, ErrNotIdentified
	}
	p, ok := s.cfg.provider(id.Provider)
	if !ok || p.Issuer != AppleIssuer {
		return nil, nil
	}
	if code == "" {
		return nil, ErrAppleConfirmationNeeded
	}
	if bearerToken(r) == "" {
		return nil, fmt.Errorf("revoke at Apple: only the app's code is exchanged")
	}
	i := slices.IndexFunc(p.Audiences, func(a string) bool { return a != p.ClientID })
	if i < 0 {
		return nil, fmt.Errorf("revoke at Apple: no app client among the audiences")
	}
	// The code was issued to the app, so the app's bundle id is the client, and signs the secret.
	app := p
	app.ClientID = p.Audiences[i]
	return func(ctx context.Context) error {
		ctx, cancel := context.WithTimeout(ctx, appleBudget)
		defer cancel()
		return s.revoke(ctx, app, code, id.Subject)
	}, nil
}

// ConfirmDeletionAtApple starts the sign-in with Apple that confirms deleting the account email
// keys (#635), for a request from the website signed in with Apple, and returns Apple's address
// for the browser to go to; "" for an app's request, which confirms with Apple's own sheet. The
// callback deletes the account once the same Apple ID has signed in (finishDeletion).
//
// The website's DELETE /api/account starts it, rather than a link to the sign-in: another site
// can send a browser to a link, but cannot send that request with the browser's session.
func (s *Service) ConfirmDeletionAtApple(w http.ResponseWriter, r *http.Request, email string) (string, error) {
	if bearerToken(r) != "" {
		return "", nil
	}
	id, ok := s.Identify(r)
	if !ok {
		return "", ErrNotIdentified
	}
	p, ok := s.cfg.provider(id.Provider)
	if !ok || p.Issuer != AppleIssuer {
		return "", nil
	}
	return s.startSignIn(w, r, p, PendingSignIn{Provider: p.ID, Deleting: email, Subject: id.Subject})
}

// finishDeletion deletes the account a sign-in with Apple confirmed deleting, once the Apple ID
// that signed in is the one the account's session had, and revokes the website's authorization
// with the tokens the sign-in brought once the deletion counts as done; a revocation that fails
// is logged, and does not keep the account. The browser goes back to the app either way: signed
// out once the account is gone, still signed in where it is not.
func (s *Service) finishDeletion(w http.ResponseWriter, r *http.Request, p Provider, pending PendingSignIn,
	ident identity.Identity, tokens *oauth2.Token) {
	http.SetCookie(w, s.signInCookie(p, "", -1))
	switch {
	case ident.Subject != pending.Subject:
		slog.InfoContext(r.Context(), "account deletion refused", "provider", p.ID,
			"reason", "another Apple ID confirmed it")
	case s.deleter == nil:
		slog.ErrorContext(r.Context(), "an account deletion Apple confirmed has nothing to delete it")
	default:
		revocation := func(ctx context.Context) error {
			ctx, cancel := context.WithTimeout(ctx, appleBudget)
			defer cancel()
			if err := s.revokeTokens(ctx, p, tokens); err != nil {
				return fmt.Errorf("revoke at Apple: %w", err)
			}
			return nil
		}
		if err := s.deleter.DeleteAccount(r.Context(), pending.Deleting, revocation); err != nil {
			slog.ErrorContext(r.Context(), "deleting an account Apple confirmed failed", "error", err)
			break
		}
		http.SetCookie(w, s.cookie(SessionCookie, "", -1))
	}
	s.backToTheApp(w, r)
}

// revoke exchanges code as p's client and revokes the refresh token it brings, or the access token
// where Apple sent none, after checking that the code is the person's whose subject this is.
func (s *Service) revoke(ctx context.Context, p Provider, code, subject string) error {
	op, err := s.discovery.provider(ctx, p)
	if err != nil {
		return fmt.Errorf("revoke at Apple: %w", err)
	}
	secret, err := p.clientSecret(s.now())
	if err != nil {
		return fmt.Errorf("revoke at Apple: %w", err)
	}
	endpoint := op.Endpoint()
	endpoint.AuthStyle = authStyle(op)
	// No redirect URI: Apple's native sheet issues the code without one.
	conf := &oauth2.Config{ClientID: p.ClientID, ClientSecret: secret, Endpoint: endpoint}
	tokens, err := conf.Exchange(ctx, code)
	if err != nil {
		return fmt.Errorf("revoke at Apple: exchanging the code: %w", err)
	}
	// Signed by Apple, for the app, about the person: no email is asked for, so none is read.
	raw, _ := tokens.Extra("id_token").(string)
	confirmed, err := op.Verifier(&oidc.Config{ClientID: p.ClientID}).Verify(ctx, raw)
	if err != nil {
		return fmt.Errorf("revoke at Apple: the exchange's ID token: %w", err)
	}
	if confirmed.Subject != subject {
		return fmt.Errorf("revoke at Apple: another Apple ID confirmed, so nothing was revoked")
	}
	if err := s.revokeTokens(ctx, p, tokens); err != nil {
		return fmt.Errorf("revoke at Apple: %w", err)
	}
	return nil
}

// revokeTokens revokes p's client's refresh token among tokens at Apple's revocation endpoint, or
// the access token where Apple sent none.
func (s *Service) revokeTokens(ctx context.Context, p Provider, tokens *oauth2.Token) error {
	op, err := s.discovery.provider(ctx, p)
	if err != nil {
		return err
	}
	var metadata struct {
		Revocation string `json:"revocation_endpoint"`
	}
	if err := op.Claims(&metadata); err != nil || metadata.Revocation == "" {
		return fmt.Errorf("the metadata names no revocation endpoint")
	}
	secret, err := p.clientSecret(s.now())
	if err != nil {
		return err
	}
	token, hint := tokens.RefreshToken, "refresh_token"
	if token == "" {
		token, hint = tokens.AccessToken, "access_token"
	}
	form := url.Values{"client_id": {p.ClientID}, "client_secret": {secret}, "token": {token}, "token_type_hint": {hint}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, metadata.Revocation, strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	_ = res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("the revocation endpoint answered %d", res.StatusCode)
	}
	return nil
}
