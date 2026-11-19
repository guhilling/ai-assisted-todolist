package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/auth"
)

// maxDeletionBody bounds a deletion's body: one authorization code from Apple, and room around it;
// maxAppleAuthorizationCode bounds the code, as the contract does.
const (
	maxDeletionBody           = 8 << 10
	maxAppleAuthorizationCode = 4096
)

// AccountDeletion deletes an account in the table (internal/store's Accounts): marked first, then
// deleted batch by batch. Settle finishes a deletion left half-way and says whether there was one.
type AccountDeletion interface {
	Mark(ctx context.Context, email string) error
	Finish(ctx context.Context, email string) error
	Settle(ctx context.Context, email string) (bool, error)
}

// DeletionRecords keeps the record a deletion leaves outside the table (internal/files), which a
// restore of the table cannot take back.
type DeletionRecords interface {
	RecordDeletion(ctx context.Context, email string) error
	ForgetDeletion(ctx context.Context, email string) error
}

// DeleteApiAccount deletes the caller's account with everything it holds (#213, #553), and ends
// its sessions on every device. It acts on the caller and takes no id, so there is nothing to
// point at anyone else's account.
//
// The record is written first, so there is no moment in which the account is gone but
// unrecorded. If the account then cannot be marked, the record is taken back and the caller told
// it failed, so the replay never carries out a deletion the user was told did not happen. Once
// marked, it counts as done (Gunnar's decision on #553): whatever stops it later is finished by
// the account's next request or by the replay.
//
// An account signed in with Apple is deleted only with Apple's confirmation (#635), and Apple's
// authorization of TaskFest is revoked once the account is marked, before the rest of it goes; a
// revocation that fails is logged, and does not keep the account: the person asked for it to go.
func (s *Server) DeleteApiAccount(w http.ResponseWriter, r *http.Request) {
	email, ok := s.Caller(r)
	if !ok {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	ctx := r.Context()
	code, ok := appleConfirmation(w, r)
	if !ok {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	revocation, err := s.SignIn.RevocationForDeletion(r, code)
	if errors.Is(err, auth.ErrAppleConfirmationNeeded) {
		w.WriteHeader(http.StatusPreconditionRequired)
		return
	} else if err != nil {
		slog.ErrorContext(ctx, "Apple's authorization cannot be revoked; the account is deleted regardless",
			"error", err)
	}
	if s.Records != nil {
		if err := s.Records.RecordDeletion(ctx, email); err != nil {
			slog.ErrorContext(ctx, "recording an account deletion failed", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
	}
	if err := s.Accounts.Mark(ctx, email); err != nil {
		slog.ErrorContext(ctx, "marking an account deleted failed", "error", err)
		if s.Records != nil {
			if err := s.Records.ForgetDeletion(ctx, email); err != nil {
				// The replay will carry it out: the user is told it failed, but asked for it.
				slog.ErrorContext(ctx, "taking back the record of a failed deletion failed", "error", err)
			}
		}
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	// Only now, as the deletion counts as done: one that failed leaves Apple as it was.
	if revocation != nil {
		if err := revocation(ctx); err != nil {
			slog.ErrorContext(ctx, "revoking Apple's authorization failed; the account is deleted regardless",
				"error", err)
		}
	}
	if err := s.Accounts.Finish(ctx, email); err != nil {
		slog.ErrorContext(ctx, "an account deletion stopped half-way; its next request or the replay finishes it",
			"error", err)
	}
	s.SignIn.EndSession(w, r)
	w.WriteHeader(http.StatusNoContent)
}

// appleConfirmation is the authorization code a deletion's body carries (AccountDeletionRequest),
// "" for a deletion without a body, and false for a body that is no such request.
func appleConfirmation(w http.ResponseWriter, r *http.Request) (string, bool) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxDeletionBody))
	if err != nil {
		return "", false
	}
	if len(body) == 0 {
		return "", true
	}
	var request AccountDeletionRequest
	if err := json.Unmarshal(body, &request); err != nil || request.AppleAuthorizationCode == nil {
		return "", err == nil
	}
	code := *request.AppleAuthorizationCode
	return code, len(code) <= maxAppleAuthorizationCode
}

// AccountEmails says which email keys the account of someone signed in with an email
// (internal/store's Accounts.AccountEmail): the email lower-cased, or for an account begun before
// #622, the email as sent.
type AccountEmails interface {
	AccountEmail(ctx context.Context, email string) (string, error)
}

// Keyed is the caller as the email their account is keyed by (AccountEmails), so that every
// route, deletion and deletion record finds the same partition however the provider cased the
// address (#622). A request whose account cannot be told is refused, as one whose deletion cannot
// be settled is.
func Keyed(caller Caller, emails AccountEmails) Caller {
	return func(r *http.Request) (string, bool) {
		email, ok := caller(r)
		if !ok {
			return email, ok
		}
		keyed, err := emails.AccountEmail(r.Context(), email)
		if err != nil {
			slog.ErrorContext(r.Context(), "reading which account an email is keyed by failed", "error", err)
			return "", false
		}
		return keyed, true
	}
}

// accountEmail is the email that keys the account of email, as Keyed has it, and false when that
// could not be read; the email itself without Emails.
func (s *Server) accountEmail(r *http.Request, email string) (string, bool) {
	if s.Emails == nil {
		return email, true
	}
	keyed, err := s.Emails.AccountEmail(r.Context(), email)
	if err != nil {
		slog.ErrorContext(r.Context(), "reading which account an email is keyed by failed", "error", err)
		return "", false
	}
	return keyed, true
}

// Settled is the caller, once any deletion of their account that was left half-way is finished
// (settle), so that no request sees what is left of it.
func Settled(caller Caller, accounts AccountDeletion) Caller {
	return func(r *http.Request) (string, bool) {
		email, ok := caller(r)
		if !ok {
			return email, ok
		}
		switch settle(r, accounts, email) {
		case refuse:
			return "", false
		case identifyAgain:
			return caller(r)
		}
		return email, ok
	}
}

// settlement is what a request does once its account is settled.
type settlement int

const (
	// serveAsIs serves the request as it came.
	serveAsIs settlement = iota
	// identifyAgain: a deletion was finished, and with it the request's own session; a website
	// session or an app session (#281) is gone, a bearer ID token goes on with a new, empty
	// account, as after any deletion.
	identifyAgain
	// refuse the request: its deletion could not be finished, or whether there is one not read.
	refuse
)

// settle finishes a deletion of the caller's account that was left half-way. One read of the
// account per request. A request is refused rather than risk showing what is left of a deleted
// account (CodeRabbit on #572, Gunnar's decision).
func settle(r *http.Request, accounts AccountDeletion, email string) settlement {
	settled, err := accounts.Settle(r.Context(), email)
	switch {
	case settled && err != nil:
		slog.ErrorContext(r.Context(), "finishing an account deletion failed", "error", err)
		return refuse
	case err != nil:
		slog.ErrorContext(r.Context(), "reading whether an account is being deleted failed", "error", err)
		return refuse
	case settled:
		return identifyAgain
	}
	return serveAsIs
}
