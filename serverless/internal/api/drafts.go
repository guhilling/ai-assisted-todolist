package api

import (
	"log/slog"
	"net/http"
)

// PostApiTasksDrafts starts a draft (#381) for the caller's add form to attach files to before
// Add; 422 when they have board.MaxOpenDrafts open already (#434), as an attachment beyond its
// limits is refused.
func (s *Server) PostApiTasksDrafts(w http.ResponseWriter, r *http.Request) {
	email, ok := s.Caller(r)
	if !ok {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	id, started, err := s.Writes.StartDraft(r.Context(), email, s.now())
	if err != nil {
		slog.ErrorContext(r.Context(), "starting a draft failed", "error", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	if !started {
		slog.InfoContext(r.Context(), "a draft is refused", "reason", "the drafts' limit")
		w.WriteHeader(http.StatusUnprocessableEntity)
		return
	}
	writeJSON(r.Context(), w, http.StatusCreated, DraftResponse{Id: id})
}

// PostApiTasksDraftsIdAdd makes the caller's draft a task, checked as a create is. Adding it again,
// as a retry whose answer was lost does (#427), sets the values on the task it became; a task
// that was never a draft takes them too, as in the Quarkus backend.
func (s *Server) PostApiTasksDraftsIdAdd(w http.ResponseWriter, r *http.Request, id int64) {
	email, ok := s.Caller(r)
	if !ok {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	req, ok := s.readNew(w, r)
	if !ok {
		return
	}
	// attachmentIds is accepted and does nothing until attachments are ported (#552), as for a
	// create.
	t, found, err := s.Writes.AddDraft(r.Context(), email, req.task(id), s.now())
	if err != nil {
		slog.ErrorContext(r.Context(), "adding a draft failed", "error", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	if !found {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	s.answerTask(w, r, http.StatusCreated, t)
}

// DeleteApiTasksDraftsId discards the caller's draft; a task with this id is not found, and
// stays.
func (s *Server) DeleteApiTasksDraftsId(w http.ResponseWriter, r *http.Request, id int64) {
	email, ok := s.Caller(r)
	if !ok {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	found, err := s.Writes.DiscardDraft(r.Context(), email, id, s.now())
	if err != nil {
		slog.ErrorContext(r.Context(), "discarding a draft failed", "error", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	if !found {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
