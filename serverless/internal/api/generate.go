// Package api is the backend's HTTP API: the routes, wire types and handlers of
// doc/api/openapi.json. The types and the routing are generated from the contract into
// api.gen.go; Serverless CI regenerates them and fails when the committed file differs.
package api

//go:generate go run ../../tools/contractgen ../../../doc/api/openapi.json api.gen.go
