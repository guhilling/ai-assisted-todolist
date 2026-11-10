package api

import "net/http"

// unported answers 501 for every route not yet ported to Go, so the router covers the whole
// contract from the start. Each method goes when its story (#547) implements the route on Server.
type unported struct{}

func notImplemented(w http.ResponseWriter) { w.WriteHeader(http.StatusNotImplemented) }

// DeleteApiAccount answers 501 until ported.
func (unported) DeleteApiAccount(w http.ResponseWriter, _ *http.Request) { notImplemented(w) }

// PostApiTasks answers 501 until ported.
func (unported) PostApiTasks(w http.ResponseWriter, _ *http.Request) { notImplemented(w) }

// PostApiTasksDrafts answers 501 until ported.
func (unported) PostApiTasksDrafts(w http.ResponseWriter, _ *http.Request) { notImplemented(w) }

// DeleteApiTasksDraftsId answers 501 until ported.
func (unported) DeleteApiTasksDraftsId(w http.ResponseWriter, _ *http.Request, _ int64) {
	notImplemented(w)
}

// PostApiTasksDraftsIdAdd answers 501 until ported.
func (unported) PostApiTasksDraftsIdAdd(w http.ResponseWriter, _ *http.Request, _ int64) {
	notImplemented(w)
}

// DeleteApiTasksId answers 501 until ported.
func (unported) DeleteApiTasksId(w http.ResponseWriter, _ *http.Request, _ int64) { notImplemented(w) }

// PutApiTasksId answers 501 until ported.
func (unported) PutApiTasksId(w http.ResponseWriter, _ *http.Request, _ int64) { notImplemented(w) }

// PostApiTasksTaskIdAttachments answers 501 until ported.
func (unported) PostApiTasksTaskIdAttachments(w http.ResponseWriter, _ *http.Request, _ int64) {
	notImplemented(w)
}

// PostApiTasksTaskIdAttachmentsLinks answers 501 until ported.
func (unported) PostApiTasksTaskIdAttachmentsLinks(w http.ResponseWriter, _ *http.Request, _ int64) {
	notImplemented(w)
}

// DeleteApiTasksTaskIdAttachmentsId answers 501 until ported.
func (unported) DeleteApiTasksTaskIdAttachmentsId(w http.ResponseWriter, _ *http.Request, _ int64, _ int64) {
	notImplemented(w)
}

// PostApiTasksTaskIdAttachmentsIdConfirm answers 501 until ported.
func (unported) PostApiTasksTaskIdAttachmentsIdConfirm(w http.ResponseWriter, _ *http.Request, _ int64, _ int64) {
	notImplemented(w)
}

// GetApiTasksTaskIdAttachmentsIdLink answers 501 until ported.
func (unported) GetApiTasksTaskIdAttachmentsIdLink(w http.ResponseWriter, _ *http.Request, _ int64, _ int64) {
	notImplemented(w)
}

// GetApiTasksTaskIdAttachmentsIdThumbnailLink answers 501 until ported.
func (unported) GetApiTasksTaskIdAttachmentsIdThumbnailLink(w http.ResponseWriter, _ *http.Request, _ int64, _ int64) {
	notImplemented(w)
}

// GetApiVersion answers 501 until ported.
func (unported) GetApiVersion(w http.ResponseWriter, _ *http.Request) { notImplemented(w) }
