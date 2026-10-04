# Continuous integration

| Workflow | Runs |
| --- | --- |
| `backend-ci.yml` | style, backend tests, the coverage gate, packaging, container image build |
| `frontend-ci.yml` | install, lint, build, frontend image build |
| `e2e.yml` | builds both images, brings the stack up, runs Playwright |
| `sonarcloud.yml` | both test suites with coverage, then the Sonar scan |

`e2e.yml` uploads the Playwright HTML report as an artifact when it fails, and dumps the
Compose logs — start there rather than trying to reproduce locally.

All four are advisory: `main` requires a pull request, but no status check is required to
merge. Do not treat a red build as optional anyway.
