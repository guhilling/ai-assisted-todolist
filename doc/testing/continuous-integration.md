# Continuous integration

| Workflow | Runs |
| --- | --- |
| `backend-ci.yml` | style, backend tests, the coverage gate, packaging, container image build |
| `frontend-ci.yml` | install, lint, build, frontend image build |
| `e2e.yml` | builds both images, brings the stack up, runs Playwright |
| `mobile-ci.yml` | the app's checks and tests, a release APK and an iOS simulator build, the Maestro flows on an emulator and the share on a simulator ([mobile development](../mobile/development.md)) |
| `live-tests.yml` | after each deploy to qa (and by hand): the [live checks](live.md) against the environment itself |
| `sonarcloud.yml` | both test suites with coverage, then the Sonar scan |
| `docs-ci.yml` | the scripts' own tests under `.github/scripts/`, and the consistency checks: doc references (the shared action from [dev-conventions](https://github.com/guhilling/dev-conventions), #455), decision records, the Renovate config, no local issue forms (#457), one PostgreSQL version, one CORS rule |
| `tofu-ci.yml` | `tofu fmt` and `validate` of the AWS roots, and that the two environments match |

`e2e.yml` uploads the Playwright HTML report as an artifact when it fails, and dumps the
Compose logs — start there rather than trying to reproduce locally.

All of them are advisory: `main` requires a pull request, but no status check is required to
merge. Do not treat a red build as optional anyway.

## Caches

The jobs keep what they download in GitHub's Actions cache: Maven's repository (`~/.m2/repository`),
npm's cache (`~/.npm`) and, for the app, Gradle's. Every branch reads them; **only `main` saves
them** (#308). A cache saved on `main`, the default branch, is readable from every branch, so a pull
request loses nothing. When a pull request's lock file differs, the restore falls back to `main`'s
latest cache for the same runner (the key without its hash) and downloads only the difference. On
`main` there is no fallback: a new entry starts empty and holds only what the build now needs,
because neither Maven nor npm ever removes an old version and a cache built on the last one would
grow with every update.

That is why the workflows do not use `setup-java`'s or `setup-node`'s own `cache:` input. It saves
an entry from every branch, one per change to a `pom.xml` or a `package-lock.json`, about 170 MB
for Maven, and Renovate's pull requests alone filled the 10 GB the repository gets. Instead, each job
restores with `actions/cache/restore`, and one job per cache saves with `actions/cache/save` under
`if: github.ref == 'refs/heads/main'`, skipped when the exact key is there already. The saving job is
the one whose build needs the most, since the other jobs only read the entry it leaves.
`.github/scripts/check-workflow-caches.py`, run by the script tests, fails when a setup action's
`cache:` input or the combined `actions/cache` comes back for these directories, when a save of
them is not kept to `main`, or when the restore steps' copies of a key differ.

| Cache | Key | Saved by, on `main` |
| --- | --- | --- |
| Maven | `maven-<os>-<arch>-<hash of the pom.xml files>` | `backend-ci.yml` (tests, coverage, mutation testing, the image); on ARM64 `e2e.yml` |
| npm | `npm-<frontend, e2e or mobile>-<os>-<arch>-<hash of its lock file>` | `frontend-ci.yml`; `e2e.yml`; Mobile CI's `checks` job, and its `ios` job for macOS |
| The browser's system packages | `browser-packages-<os>-<arch>-<hash of e2e's lock file>`, the `.deb` files apt downloaded for Playwright's Chromium: on amd64 Ubuntu's mirror took eight minutes over them | `e2e.yml` |
| Gradle | `gradle/actions/setup-gradle`'s own | Mobile CI's `android` job |

Two caches are saved from pull requests too, deliberately: Mobile CI's APK and its iOS simulator
build, each reused while the app is unchanged ([mobile development](../mobile/development.md)). The emulator's setup is not in the
Actions cache at all but on GitHub's Container Registry, for the same reason of size.
