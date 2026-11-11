package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/board"
	"github.com/guhilling/ai-assisted-todolist/serverless/internal/files"
)

// AttachmentWrites is where the handlers keep a user's attachments (#552): the DynamoDB store, or a
// test's. An attachment, or a task, that is not the user's is board.ErrNotFound, never touched.
type AttachmentWrites interface {
	Attach(ctx context.Context, email string, taskID int64, a board.Attachment, now time.Time) (board.Attachment, error)
	Attachment(ctx context.Context, email string, taskID, id int64, now time.Time) (board.Attachment, error)
	Confirm(ctx context.Context, email string, taskID, id int64, thumbnail bool, now time.Time) (board.Attachment, error)
	RemoveAttachment(ctx context.Context, email string, id int64) error
	Reattach(ctx context.Context, email string, taskID int64, ids []int64, now time.Time) error
}

// FileStore is the attachment bucket as the handlers use it: internal/files, or a test's.
type FileStore interface {
	UploadLink(ctx context.Context, key, contentType string, size int64) (files.Link, error)
	DownloadLink(ctx context.Context, key, contentType, fileName string) (files.Link, error)
	Head(ctx context.Context, key string) (files.Object, bool, error)
	Delete(ctx context.Context, key string) error
}

// The bounds on what a client may send, the Quarkus backend's request records'. A file name or
// title may be longer than what is kept, and is cut to fit rather than refused.
const (
	maxAnnouncedFileName = 1024
	maxContentType       = 255
	maxGivenTitle        = 1024
	// thumbnailType is what a thumbnail is: a JPEG, which every browser's canvas can write.
	thumbnailType = "image/jpeg"
)

// readFields decodes a JSON object's keys into the targets, as Jackson reads a record: a key counts
// only as written, of a key given twice the last counts, and keys nobody asked for are ignored.
func readFields(body io.Reader, into map[string]any) error {
	var fields map[string]json.RawMessage
	if err := json.NewDecoder(body).Decode(&fields); err != nil {
		return err
	}
	for key, target := range into {
		if raw, ok := fields[key]; ok {
			if err := json.Unmarshal(raw, target); err != nil {
				return err
			}
		}
	}
	return nil
}

// badRequest answers 400, logging why.
func badRequest(w http.ResponseWriter, r *http.Request, why string) {
	slog.InfoContext(r.Context(), "an attachment request is refused", "reason", why)
	w.WriteHeader(http.StatusBadRequest)
}

// failure answers an error from the store: 404 for what is not the caller's, 422 for a refusal,
// otherwise 500.
func failure(w http.ResponseWriter, r *http.Request, what string, err error) {
	var refused board.Refusal
	switch {
	case errors.Is(err, board.ErrNotFound):
		w.WriteHeader(http.StatusNotFound)
	case errors.As(err, &refused):
		slog.InfoContext(r.Context(), "an attachment is refused", "reason", string(refused))
		writeJSON(r.Context(), w, http.StatusUnprocessableEntity, RefusalResponse{Refusal: RefusalResponseRefusal(refused)})
	default:
		slog.ErrorContext(r.Context(), what+" failed", "error", err)
		w.WriteHeader(http.StatusInternalServerError)
	}
}

// attachmentResponse is an attachment as the contract sends it.
func attachmentResponse(a board.Attachment) AttachmentResponse {
	out := AttachmentResponse{Id: a.ID, FileName: a.FileName, ContentType: a.Kind.ContentType(),
		SizeBytes: a.SizeBytes, Thumbnail: a.Thumbnail}
	if a.URL != "" {
		out.Url = &a.URL
	}
	return out
}

// PostApiTasksTaskIdAttachments announces an upload to the caller's task or draft: checks the type
// and the limits, records the attachment as pending and answers with a link that accepts exactly
// this file, and for an image whose thumbnail fits, a second link for that (#236).
func (s *Server) PostApiTasksTaskIdAttachments(w http.ResponseWriter, r *http.Request, taskID int64) {
	email, ok := s.Caller(r)
	if !ok {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	var name, contentType *string
	var size, thumbnailSize *int64
	if err := readFields(r.Body, map[string]any{"fileName": &name, "contentType": &contentType,
		"sizeBytes": &size, "thumbnailSizeBytes": &thumbnailSize}); err != nil {
		badRequest(w, r, err.Error())
		return
	}
	switch {
	case name == nil || board.Blank(*name) || board.Length(*name) > maxAnnouncedFileName:
		badRequest(w, r, "the file name")
		return
	case contentType == nil || board.Length(*contentType) > maxContentType:
		badRequest(w, r, "the content type")
		return
	case size == nil || *size < 1:
		badRequest(w, r, "the size")
		return
	}
	// An unknown type is no kind, which the store refuses as UNSUPPORTED_TYPE once the task is
	// found, as Quarkus answers a missing task first.
	kind, _ := board.KindOf(*contentType)
	a, err := s.Attachments.Attach(r.Context(), email, taskID,
		board.Attachment{FileName: board.CleanFileName(*name), Kind: kind, SizeBytes: *size}, s.now())
	if err != nil {
		failure(w, r, "announcing an upload", err)
		return
	}
	upload, err := s.Files.UploadLink(r.Context(), a.ObjectKey, kind.ContentType(), a.SizeBytes)
	if err != nil {
		failure(w, r, "signing an upload link", err)
		return
	}
	out := UploadResponse{Attachment: attachmentResponse(a), Url: upload.URL, Headers: upload.Headers,
		ExpiresAt: upload.ExpiresAt}
	// One that does not fit, zero or less included, is not offered a link; the file is not refused for it.
	if thumbnailSize != nil && kind.IsImage() && *thumbnailSize > 0 && *thumbnailSize <= board.MaxThumbnailBytes {
		thumbnail, err := s.Files.UploadLink(r.Context(), board.ThumbnailKey(a.ObjectKey), thumbnailType, *thumbnailSize)
		if err != nil {
			failure(w, r, "signing a thumbnail's upload link", err)
			return
		}
		out.ThumbnailUpload = &ThumbnailUploadResponse{Url: thumbnail.URL, Headers: thumbnail.Headers}
		// Each link ends with the session that signed it (#434), which may rotate between the two.
		if thumbnail.ExpiresAt.Before(out.ExpiresAt) {
			out.ExpiresAt = thumbnail.ExpiresAt
		}
	}
	writeJSON(r.Context(), w, http.StatusCreated, out)
}

// PostApiTasksTaskIdAttachmentsLinks adds a link to the caller's task or draft (#414), with the
// page's title where the sharing app gave one: counted against the same limits as files, and
// available at once.
func (s *Server) PostApiTasksTaskIdAttachmentsLinks(w http.ResponseWriter, r *http.Request, taskID int64) {
	email, ok := s.Caller(r)
	if !ok {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	var url, title *string
	if err := readFields(r.Body, map[string]any{"url": &url, "title": &title}); err != nil {
		badRequest(w, r, err.Error())
		return
	}
	if url == nil || !board.WebAddress(*url) {
		badRequest(w, r, "not a web address")
		return
	}
	if title != nil && board.Length(*title) > maxGivenTitle {
		badRequest(w, r, "the title")
		return
	}
	a, err := s.Attachments.Attach(r.Context(), email, taskID,
		board.Attachment{FileName: board.LinkTitle(title, *url), Kind: board.KindLink, URL: *url}, s.now())
	if err != nil {
		failure(w, r, "adding a link", err)
		return
	}
	writeJSON(r.Context(), w, http.StatusCreated, attachmentResponse(a))
}

// PostApiTasksTaskIdAttachmentsIdConfirm makes an upload available once storage has it with the
// announced size and type, which the signed link already enforced: this is the check that it
// arrived at all. 409 while it has not; a mismatch, which the link should make impossible, deletes
// file and attachment.
func (s *Server) PostApiTasksTaskIdAttachmentsIdConfirm(w http.ResponseWriter, r *http.Request, taskID, id int64) {
	email, ok := s.Caller(r)
	if !ok {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	ctx := r.Context()
	a, err := s.Attachments.Attachment(ctx, email, taskID, id, s.now())
	if err != nil {
		failure(w, r, "finding an attachment", err)
		return
	}
	if a.Available {
		writeJSON(ctx, w, http.StatusOK, attachmentResponse(a))
		return
	}
	object, arrived, err := s.Files.Head(ctx, a.ObjectKey)
	if err != nil {
		failure(w, r, "looking for an upload", err)
		return
	}
	if !arrived {
		w.WriteHeader(http.StatusConflict)
		return
	}
	if kind, _ := board.KindOf(object.ContentType); object.Size != a.SizeBytes || kind != a.Kind {
		if err := s.remove(ctx, email, a); err != nil {
			failure(w, r, "removing a mismatched upload", err)
			return
		}
		failure(w, r, "confirming", board.RefusedMismatch)
		return
	}
	// The thumbnail's link signed its type and a size within the limit; this asks whether it came.
	thumbnail := false
	if a.Kind.IsImage() {
		got, there, err := s.Files.Head(ctx, board.ThumbnailKey(a.ObjectKey))
		if err != nil {
			failure(w, r, "looking for a thumbnail", err)
			return
		}
		thumbnail = there && got.ContentType == thumbnailType
	}
	confirmed, err := s.Attachments.Confirm(ctx, email, taskID, id, thumbnail, s.now())
	if errors.Is(err, board.ErrNotFound) {
		// Gone between the look into storage and here: never available, as Quarkus answers it.
		w.WriteHeader(http.StatusConflict)
		return
	}
	if err != nil {
		failure(w, r, "confirming an upload", err)
		return
	}
	writeJSON(ctx, w, http.StatusOK, attachmentResponse(confirmed))
}

// GetApiTasksTaskIdAttachmentsIdLink answers a link for the caller's browser to open the file with,
// straight from storage, the same one again while it is fresh (#236); a link attachment's own
// address, which an app from before links (#268) asks for.
func (s *Server) GetApiTasksTaskIdAttachmentsIdLink(w http.ResponseWriter, r *http.Request, taskID, id int64) {
	a, ok := s.available(w, r, taskID, id)
	if !ok {
		return
	}
	if !a.Kind.IsFile() {
		s.answerLink(w, r, files.Link{URL: a.URL, ExpiresAt: s.now().Add(board.DownloadLinkLifetime)}, nil)
		return
	}
	link, err := s.Files.DownloadLink(r.Context(), a.ObjectKey, a.Kind.ContentType(), a.FileName)
	s.answerLink(w, r, link, err)
}

// GetApiTasksTaskIdAttachmentsIdThumbnailLink answers a link to an image's preview thumbnail, like
// the file's; 404 when it has none.
func (s *Server) GetApiTasksTaskIdAttachmentsIdThumbnailLink(w http.ResponseWriter, r *http.Request, taskID, id int64) {
	a, ok := s.available(w, r, taskID, id)
	if !ok {
		return
	}
	if !a.Thumbnail {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	link, err := s.Files.DownloadLink(r.Context(), board.ThumbnailKey(a.ObjectKey), thumbnailType, a.FileName)
	s.answerLink(w, r, link, err)
}

// available is the caller's available attachment, having answered the request when there is none.
func (s *Server) available(w http.ResponseWriter, r *http.Request, taskID, id int64) (board.Attachment, bool) {
	email, ok := s.Caller(r)
	if !ok {
		w.WriteHeader(http.StatusUnauthorized)
		return board.Attachment{}, false
	}
	a, err := s.Attachments.Attachment(r.Context(), email, taskID, id, s.now())
	if err == nil && !a.Available {
		err = board.ErrNotFound
	}
	if err != nil {
		failure(w, r, "finding an attachment", err)
		return board.Attachment{}, false
	}
	return a, true
}

// answerLink answers with a link, and lets the browser keep the answer for as long as the same
// link is handed out, written as JAX-RS writes a CacheControl.
func (s *Server) answerLink(w http.ResponseWriter, r *http.Request, link files.Link, err error) {
	if err != nil {
		failure(w, r, "signing a link", err)
		return
	}
	keep := files.KeepFor(link, s.now())
	w.Header().Set("Cache-Control", fmt.Sprintf("private, no-transform, max-age=%d", int(keep.Seconds())))
	writeJSON(r.Context(), w, http.StatusOK, LinkResponse{Url: link.URL, ExpiresAt: link.ExpiresAt})
}

// DeleteApiTasksTaskIdAttachmentsId removes the caller's attachment, its file and thumbnail too.
func (s *Server) DeleteApiTasksTaskIdAttachmentsId(w http.ResponseWriter, r *http.Request, taskID, id int64) {
	email, ok := s.Caller(r)
	if !ok {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	a, err := s.Attachments.Attachment(r.Context(), email, taskID, id, s.now())
	if err == nil {
		err = s.remove(r.Context(), email, a)
	}
	if err != nil {
		failure(w, r, "removing an attachment", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// remove deletes an attachment: its item first, then its file and thumbnail. A failure in between
// leaves files whose item is gone, which the table's stream deletes in any case, as it does those
// of every attachment item deleted, by expiry included.
func (s *Server) remove(ctx context.Context, email string, a board.Attachment) error {
	if err := s.Attachments.RemoveAttachment(ctx, email, a.ID); err != nil {
		return err
	}
	if a.ObjectKey == "" {
		return nil
	}
	return errors.Join(s.Files.Delete(ctx, a.ObjectKey), s.Files.Delete(ctx, board.ThumbnailKey(a.ObjectKey)))
}
