# Continuous integration

| Workflow | Runs |
| --- | --- |
| `contract-ci.yml` | when `doc/api/` changes: the contract is valid OpenAPI 3.1, what `generate.py` derives from it is current, and oasdiff finds nothing that breaks the oldest release in use (#559) |
| `frontend-ci.yml` | install, lint, build, frontend image build |
| `e2e-serverless.yml` | builds the Go backend's and the frontend's images, brings [the stack](../local-development/end-to-end-stack.md) up and runs Playwright, on amd64, when the Go backend, the frontend, the suite or Keycloak change; collects the live checks |
| `mobile-ci.yml` | the app's checks and tests, a release APK and an iOS simulator build, the Maestro flows on an emulator and the share on a simulator ([mobile development](../mobile/development.md)) |
| `live-tests.yml` | after each deploy to qa (and by hand): the [live checks](live.md) against the environment itself |
| `qa-traffic.yml` | every hour: ten anonymous requests to qa, for the dashboards, and fails when one answers otherwise ([live.md](live.md#hourly-traffic)) |
| `sonarcloud.yml` | the frontend's and the Go backend's tests with coverage (the Go ones start DynamoDB Local in Docker), then the Sonar scan |
| `docs-ci.yml` | the scripts' own tests under `.github/scripts/`, and the consistency checks: doc references (the shared action from [conventions](https://github.com/guhilling/conventions), #455), decision records, the Renovate config, no local issue forms (#457), links to private resources marked (#531), one CORS rule |
| `tofu-ci.yml` | `tofu fmt` and `validate` of the AWS roots, and that the two environments match |
| `serverless-ci.yml` | the [Go backend](../deployment/serverless.md) (#547), also when `doc/api/openapi.json` changes: the generated contract code is current, gofmt, `go vet`, `go test -race` (DynamoDB Local in a container among them), the arm64 Lambda build, shellcheck of its scripts; no cache |

`e2e-serverless.yml` uploads the Playwright HTML report as an artifact when it fails, and dumps the
Compose logs — start there rather than trying to reproduce locally.

All of them are advisory: `main` requires a pull request, but no status check is required to
merge. Do not treat a red build as optional anyway.

## Caches

The jobs keep what they download in GitHub's Actions cache: npm's cache (`~/.npm`), the browser's
system packages and, for the app, Gradle's. Maven's repository was one of them until the Quarkus
backend went (#559). Every branch reads them; **only `main` saves
them** (#308). A cache saved on `main`, the default branch, is readable from every branch, so a pull
request loses nothing. When a pull request's lock file differs, the restore falls back to `main`'s
latest cache for the same runner (the key without its hash) and downloads only the difference. On
`main` there is no fallback: a new entry starts empty and holds only what the build now needs,
because npm never removes an old version and a cache built on the last one would grow with every
update.

That is why the workflows do not use `setup-java`'s or `setup-node`'s own `cache:` input. It saves
an entry from every branch, one per change to a `pom.xml` or a `package-lock.json` -- about 170 MB
for Maven, when there was one -- and Renovate's pull requests alone filled the 10 GB the repository
gets. Instead, each job
restores with `actions/cache/restore`, and one job per cache saves with `actions/cache/save` under
`if: github.ref == 'refs/heads/main'`, skipped when the exact key is there already. The saving job is
the one whose build needs the most, since the other jobs only read the entry it leaves.
`.github/scripts/check-workflow-caches.py`, run by the script tests, fails when a setup action's
`cache:` input or the combined `actions/cache` comes back for these directories, when a save of
them is not kept to `main`, or when the restore steps' copies of a key differ.

| Cache | Key | Saved by, on `main` |
| --- | --- | --- |
| npm | `npm-<frontend, e2e or mobile>-<os>-<arch>-<hash of its lock file>` | `frontend-ci.yml`; `e2e-serverless.yml`; Mobile CI's `checks` job, and its `ios` job for macOS |
| The browser's system packages | `browser-packages-<os>-<arch>-<hash of e2e's lock file>`, the `.deb` files apt downloaded for Playwright's Chromium: on amd64 Ubuntu's mirror took eight minutes over them | `e2e-serverless.yml` |
| Gradle | `gradle/actions/setup-gradle`'s own | Mobile CI's `android` job |

Two caches are saved from pull requests too, deliberately: Mobile CI's APK and its iOS simulator
build, each reused while the app is unchanged ([mobile development](../mobile/development.md)). The emulator's setup is not in the
Actions cache at all but on GitHub's Container Registry, for the same reason of size.
