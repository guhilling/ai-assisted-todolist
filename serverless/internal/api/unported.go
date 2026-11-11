package api

import "net/http"

// unported answers 501 for every route not yet ported to Go, so the router covers the whole
// contract from the start. Each method goes when its story (#547) implements the route on Server.
type unported struct{}

// notImplemented answers 501.
func notImplemented(w http.ResponseWriter) { w.WriteHeader(http.StatusNotImplemented) }

// DeleteApiAccount answers 501 until ported.
func (unported) DeleteApiAccount(w http.ResponseWriter, _ *http.Request) { notImplemented(w) }

// GetApiVersion answers 501 until ported.
func (unported) GetApiVersion(w http.ResponseWriter, _ *http.Request) { notImplemented(w) }
