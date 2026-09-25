# Documentation

Project-level documentation for `ai-assisted-todolist`. This folder is the source of
truth; the root `README.md` is a short entry point that links here.

| Document | What it covers |
| --- | --- |
| [purpose.md](purpose.md) | What this project is for, and the working conventions that follow from that |
| [architecture.md](architecture.md) | The pieces, how a request travels through them, and how they are deployed |
| [domain-model.md](domain-model.md) | Ubiquitous language, the Task aggregate, and where each invariant is enforced |
| [authentication.md](authentication.md) | The backend-for-frontend OIDC design, Google in production, Keycloak locally |
| [local-development.md](local-development.md) | How to get everything running on your machine, and how to test it |
| [testing.md](testing.md) | The test layers, what each is for, and how to run them |
| [decisions.md](decisions.md) | Decisions taken, why, and what was rejected |

## Keeping it current

Documentation is updated in the same change as the behaviour it describes, not as a
follow-up. The root README already showed what happens otherwise: it documented an
`/api/todos` endpoint and four task states that had not existed for some time.

Code-level documentation lives in the code as Javadoc and TSDoc. The conventions for it
are in `backend/CLAUDE.md` and `frontend/CLAUDE.md`, and the backend build enforces them:
Checkstyle's `MissingJavadocType` fails `./mvnw verify` on a public type with no Javadoc.
