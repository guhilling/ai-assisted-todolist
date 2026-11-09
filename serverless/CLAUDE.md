# serverless/

The Go code of the serverless backend (#535): today the spike, `GET /api/tasks` on Lambda from
DynamoDB. [doc/deployment/serverless.md](../doc/deployment/serverless.md) has the design and how
to run it.

Gunnar does not write or read Go by choice, so the code has to be reviewable by what it does:

- **Every package and exported identifier has a doc comment saying what it is for**, the Go
  counterpart of the backend's Javadoc rule.
- **The domain imports no AWS package.** `internal/board` is plain Go; Lambda's event types stay
  in `cmd/`, DynamoDB's in `internal/store`. That is the line that keeps the AWS lock-in (one of
  the decision's drawbacks) to the edges.
- **Tests sit next to the code** (`*_test.go`), with fakes for the one AWS call each part makes,
  and TDD holds as everywhere else in the repository.
- **gofmt, `go vet` and `go test -race`** are what Serverless CI runs; run them before a commit.
- **The wire format is the API's**, `doc/api/openapi.json`. The spike writes `TaskResponse` by
  hand; the port generates it from the contract.
