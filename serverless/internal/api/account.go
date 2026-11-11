package api

import (
	"context"
	"log/slog"
	"net/http"
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
func (s *Server) DeleteApiAccount(w http.ResponseWriter, r *http.Request) {
	email, ok := s.Caller(r)
	if !ok {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	ctx := r.Context()
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
	if err := s.Accounts.Finish(ctx, email); err != nil {
		slog.ErrorContext(ctx, "an account deletion stopped half-way; its next request or the replay finishes it",
			"error", err)
	}
	s.SignIn.EndSession(w, r)
	w.WriteHeader(http.StatusNoContent)
}

// Settled is the caller, once any deletion of their account that was left half-way is finished,
// so that no request sees what is left of it. One read of the account per request. A deletion
// finished here also ended the request's own session, so the caller is identified again: a
// website session is gone, an app's bearer token goes on with a new, empty account, as after any
// deletion. One that cannot be finished is not served; a read that fails is logged and the
// request served, as its own reads fail too.
func Settled(caller Caller, accounts AccountDeletion) Caller {
	return func(r *http.Request) (string, bool) {
		email, ok := caller(r)
		if !ok {
			return email, ok
		}
		settled, err := accounts.Settle(r.Context(), email)
		switch {
		case settled && err != nil:
			slog.ErrorContext(r.Context(), "finishing an account deletion failed", "error", err)
			return "", false
		case err != nil:
			slog.ErrorContext(r.Context(), "reading whether an account is being deleted failed", "error", err)
		case settled:
			return caller(r)
		}
		return email, ok
	}
}
