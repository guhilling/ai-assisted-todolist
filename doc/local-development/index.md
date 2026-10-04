# Running the application locally

Two ways to run the whole thing. Pick by what you are doing:

| | Dev mode | Container stack |
| --- | --- | --- |
| **Use it for** | Working on the app | Checking the container images |
| **Starts** | Quarkus dev mode + Vite, with PostgreSQL and Keycloak in containers | Everything in containers |
| **Sign-in** | Works out of the box, local accounts | Off, unless you supply Google credentials |
| **Live reload** | Yes, both sides | No |
| **Open** | `http://localhost:5173` | `http://localhost:3000` |

**Dev mode is the default answer.** It is the only one of the two where you can sign in
without external credentials.

**Neither is the shape of AWS.** In AWS there is no httpd: the frontend comes from an S3 bucket
through CloudFront, which also routes `/api/*` to the backend and gives deep links their
`index.html`. The container stack checks the images and how they run together; what only AWS
does is checked in qa itself — see [the deployment chapter](../deployment/index.md).

## Prerequisites

- **A container engine** — Docker Desktop or Podman. Quarkus Dev Services needs a reachable
  socket; with Podman, `DOCKER_HOST` must point at the machine's socket (see
  [Troubleshooting](troubleshooting.md)).
- **JDK 25, Temurin.** `java -version` should report 25. Maven comes from the wrapper.
- **Node 22** and npm, for the frontend.

Nothing else. In particular you need no `.env` file, no database installed, and no OIDC
credentials of your own.


## In this chapter

| Page | What it covers |
| --- | --- |
| [Dev mode](dev-mode.md) | Running backend and frontend from source, with live reload |
| [Container stack](container-stack.md) | The Compose stack, with the images CI builds |
| [End-to-end stack](end-to-end-stack.md) | The stack the Playwright suite runs against |
| [Troubleshooting](troubleshooting.md) | What goes wrong locally, and what to do about it |
