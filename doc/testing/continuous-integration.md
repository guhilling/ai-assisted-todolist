# Continuous integration

| Workflow | Runs |
| --- | --- |
| `backend-ci.yml` | style, backend tests, the coverage gate, packaging, container image build |
| `frontend-ci.yml` | install, lint, build, frontend image build |
| `e2e.yml` | builds both images, brings the stack up, runs Playwright |
| `live-tests.yml` | after each deploy to qa (and by hand): the [live checks](live.md) against the environment itself |
| `sonarcloud.yml` | both test suites with coverage, then the Sonar scan |

`e2e.yml` uploads the Playwright HTML report as an artifact when it fails, and dumps the
Compose logs — start there rather than trying to reproduce locally.

All four are advisory: `main` requires a pull request, but no status check is required to
merge. Do not treat a red build as optional anyway.

## Caches

The jobs keep what they download in GitHub's Actions cache: Maven's repository (`~/.m2/repository`),
npm's cache (`~/.npm`) and, for the app, Gradle's. Every branch reads them; **only `main` saves
them** (#308). A cache is readable from the branch that saved it and from any branch based on
`main`, so a pull request loses nothing. If a pull request's lock file differs, the
restore falls back to `main`'s latest cache for the same runner (the key without its hash), and
only the difference is downloaded.

That is why the workflows do not use `setup-java`'s or `setup-node`'s own `cache:` input. It saves
an entry from every branch, one per change to a `pom.xml` or a `package-lock.json`, about 170 MB
for Maven, and Renovate's pull requests alone filled the 10 GB the repository gets. Instead, each job
restores with `actions/cache/restore` and saves with `actions/cache/save` under
`if: github.ref == 'refs/heads/main'`, skipped when the exact key is there already.
`.github/scripts/check-workflow-caches.py`, run by the script tests, fails when a workflow does
otherwise.

| Cache | Key | Saved by |
| --- | --- | --- |
| Maven | `maven-<os>-<arch>-<hash of the pom.xml files>` | any job on `main` that builds the backend; the first to finish wins |
| npm | `npm-<frontend, e2e or mobile>-<os>-<arch>-<hash of its lock file>` | the jobs on `main` that install that project |
| Gradle | `gradle/actions/setup-gradle`'s own | Mobile CI's `android` job on `main` |

One cache is saved from pull requests too, deliberately: Mobile CI's APK, reused while the app is
unchanged ([mobile development](../mobile/development.md)). The emulator's setup
is not in the Actions cache at all but on GitHub's Container Registry, for the same reason of size.
