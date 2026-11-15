# Running the application locally

Two ways to run the whole thing. Pick by what you are doing:

| | From source | End-to-end stack |
| --- | --- | --- |
| **Use it for** | Working on the app | Running the browser suite, checking the images |
| **Starts** | `go run ./cmd/api` + Vite, with the stack's Keycloak, DynamoDB Local and SeaweedFS | Everything in containers |
| **Sign-in** | Works out of the box, local accounts | The same |
| **Live reload** | The frontend's; the Go server is restarted by hand | No |
| **Open** | `http://localhost:5173` | `http://localhost:3000` |

**From source** starts the [end-to-end stack](end-to-end-stack.md) and stops its backend and
frontend, then runs the Go backend with the command in
[serverless.md](../deployment/serverless.md#the-code), which listens on `:8080`, and the frontend
with `npm run dev` in `frontend/`, whose Vite server proxies `/api` there. The Quarkus backend's
dev mode and its container stack went with it (#559); the tag `pre-serverless` keeps them.

**Neither is the shape of AWS.** In AWS there is no httpd: the frontend comes from an S3 bucket
through CloudFront, which also routes `/api/*` to the backend's Lambda function and gives deep
links their `index.html`. The stack checks the images and how they run together; what only AWS
does is checked in qa itself — see [the deployment chapter](../deployment/index.md).

## Prerequisites

- **A container engine** — Docker Desktop or Podman, for the stack (see
  [Troubleshooting](troubleshooting.md)).
- **Go**, the version `serverless/go.mod` names, to run the backend from source.
- **Node 22** and npm, for the frontend and the end-to-end suite.

Nothing else. In particular you need no `.env` file, no database installed, and no OIDC
credentials of your own: Keycloak's realm (`keycloak/realm-taskfest.json`) has the accounts.

## In this chapter

| Page | What it covers |
| --- | --- |
| [End-to-end stack](end-to-end-stack.md) | The stack the Playwright suite runs against |
| [Troubleshooting](troubleshooting.md) | What goes wrong locally, and what to do about it |
