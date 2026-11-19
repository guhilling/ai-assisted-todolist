package auth

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"golang.org/x/oauth2"
)

// AppleIssuer is Sign in with Apple's issuer. Apple asks an app that offers it to revoke its
// authorization when an account is deleted (#635); no other provider is asked anything then.
const AppleIssuer = "https://appleid.apple.com"

// ErrAppleConfirmationNeeded refuses deleting an account signed in with Apple without Apple's
// confirmation: the authorization code its sheet issues when the person signs in with it once more.
var ErrAppleConfirmationNeeded = errors.New("deleting an account signed in with Apple needs Apple's confirmation")

// revocationTimeout bounds the exchange of the code and the revocation, each.
const revocationTimeout = 10 * time.Second

// RevokeForDeletion ends Sign in with Apple's authorization of TaskFest before the account of a
// request signed in with Apple is deleted (#635), so that TaskFest is no longer listed under the
// person's Apple ID. The code is the authorization code Apple's sheet issued when the person
// signed in with Apple once more, to confirm: it is exchanged for Apple's tokens, and the refresh
// token is revoked at once. Nothing is kept, as nothing of Apple's is
// (doc/decisions/authentication.md).
//
// A request signed in with any other provider is asked for nothing, and returns nil. One signed
// in with Apple returns ErrAppleConfirmationNeeded without a code, and otherwise whatever stopped
// the exchange or the revocation, which the caller logs and goes on deleting.
//
// Only the app's code is exchanged here, as the app's bundle id, the first of Apple's audiences
// besides the website's client: the website's comes back to its callback.
func (s *Service) RevokeForDeletion(r *http.Request, code string) error {
	id, ok := s.Identify(r)
	if !ok {
		return nil
	}
	p, ok := s.cfg.provider(id.Provider)
	if !ok || p.Issuer != AppleIssuer {
		return nil
	}
	if code == "" {
		return ErrAppleConfirmationNeeded
	}
	if bearerToken(r) == "" {
		return fmt.Errorf("revoke at Apple: only the app's code is exchanged")
	}
	i := slices.IndexFunc(p.Audiences, func(a string) bool { return a != p.ClientID })
	if i < 0 {
		return fmt.Errorf("revoke at Apple: no app client among the audiences")
	}
	// The code was issued to the app, so the app's bundle id is the client, and signs the secret.
	app := p
	app.ClientID = p.Audiences[i]
	return s.revoke(r.Context(), app, code)
}

// revoke exchanges code as p's client and revokes the refresh token it brings, or the access
// token where Apple sent none.
func (s *Service) revoke(ctx context.Context, p Provider, code string) error {
	op, err := s.discovery.provider(ctx, p)
	if err != nil {
		return fmt.Errorf("revoke at Apple: %w", err)
	}
	var metadata struct {
		Revocation string `json:"revocation_endpoint"`
	}
	if err := op.Claims(&metadata); err != nil || metadata.Revocation == "" {
		return fmt.Errorf("revoke at Apple: the metadata names no revocation endpoint")
	}
	secret, err := p.clientSecret(s.now())
	if err != nil {
		return fmt.Errorf("revoke at Apple: %w", err)
	}
	endpoint := op.Endpoint()
	endpoint.AuthStyle = oauth2.AuthStyleInParams
	// No redirect URI: Apple's native sheet issues the code without one.
	conf := &oauth2.Config{ClientID: p.ClientID, ClientSecret: secret, Endpoint: endpoint}
	exchangeCtx, cancel := context.WithTimeout(ctx, revocationTimeout)
	defer cancel()
	tokens, err := conf.Exchange(exchangeCtx, code)
	if err != nil {
		return fmt.Errorf("revoke at Apple: exchanging the code: %w", err)
	}
	token, hint := tokens.RefreshToken, "refresh_token"
	if token == "" {
		token, hint = tokens.AccessToken, "access_token"
	}
	form := url.Values{"client_id": {p.ClientID}, "client_secret": {secret}, "token": {token}, "token_type_hint": {hint}}
	revokeCtx, cancelRevoke := context.WithTimeout(ctx, revocationTimeout)
	defer cancelRevoke()
	req, err := http.NewRequestWithContext(revokeCtx, http.MethodPost, metadata.Revocation, strings.NewReader(form.Encode()))
	if err != nil {
		return fmt.Errorf("revoke at Apple: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("revoke at Apple: %w", err)
	}
	_ = res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("revoke at Apple: the revocation endpoint answered %d", res.StatusCode)
	}
	return nil
}
