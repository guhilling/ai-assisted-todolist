# serverless/

The Go backend (#547), being ported from Quarkus: `cmd/api` serves every route of the contract,
the unported ones answering 501, on Lambda or as a plain HTTP server. `cmd/tasks` is the spike's
handler, kept until the spike's infrastructure goes (#554).
[doc/deployment/serverless.md](../doc/deployment/serverless.md) has the design and how to run it.

Gunnar does not write or read Go by choice, so the code has to be reviewable by what it does:

- **Every package and exported identifier has a doc comment saying what it is for**, the Go
  counterpart of the backend's Javadoc rule.
- **The domain imports no AWS package.** `internal/board` is plain Go; Lambda's event types stay
  in `cmd/`, DynamoDB's in `internal/store`. That is the line that keeps the AWS lock-in (one of
  the decision's drawbacks) to the edges.
- **Tests sit next to the code** (`*_test.go`), with fakes for the one AWS call each part makes,
  and TDD holds as everywhere else in the repository.
- **gofmt, `go vet` and `go test -race`** are what Serverless CI runs; run them before a commit.
  The store's tests start DynamoDB Local through Testcontainers, so they need podman or docker.
- **The wire format is the API's**, `doc/api/openapi.json`. `internal/api/api.gen.go` is
  generated from it by `go generate ./...` (oapi-codegen, a `tool` in `go.mod`) and never edited;
  `tools/contractgen` adds one rule on the way, that a field which may be null is sent as null,
  as Quarkus sends it. `internal/api/contract_test.go` checks responses against the contract.
- **Behaviour matches the Quarkus backend, not just the schema.** Where the contract allows
  more than one answer, the Go code gives the one Quarkus gives.
