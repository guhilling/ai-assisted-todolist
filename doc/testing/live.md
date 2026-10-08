# Live tests

The other layers test the code. This one tests a **deployed environment** from the outside,
through CloudFront, the way a visitor reaches it — the part of qa that, until now, was checked by
hand after each change, and where things fail that cannot fail anywhere else (#141).

It has two parts:

| Part | What it needs | Issue |
| --- | --- | --- |
| **Smoke checks** — everything that can be checked without signing in | nothing: no account, no AWS role, no secret | #142 |
| **The signed-in scenarios** — tasks, two users kept apart and never served from a cache, sign-out | qa's Cognito test accounts, with a password set per run | #144 |

## What the smoke checks check

`e2e/live/smoke.spec.ts`, run with `e2e/playwright.live.config.ts`:

| Group | Check | Would have caught |
| --- | --- | --- |
| Frontend | the app loads | a broken site bucket or distribution |
| | a deep link is the app with a 200 | the SPA routing function gone (#110) |
| | a missing asset is a 403, not the app | routing that answers *everything* with `index.html` |
| | `index.html` is `no-cache`, hashed assets `immutable` | a deploy that broke `deploy-frontend.yml`'s three passes |
| While down | the page says *Environment QA is paused at the moment.*, named by `/environment.json` | the paused page lost, or the deploy no longer writing the name |
| API | `/api/auth/providers` answers and offers Google | the `/api/*` behaviour or the VPC origin broken |
| | `/api/tasks` refuses without a session: 499 for a script, a redirect to Google for a navigation | authentication switched off, or the app's HTML returned for an API path |
| | `/api/*` is a `Miss` on a repeated request | caching on the API, which would serve one user's answer to another |
| | *Sign in with Google* ends at Google with `redirect_uri=https://<host>/api/auth/callback` | the http/https return-address regression (#119) |

The last one goes up to Google's door and not through it: following the button is checked,
signing in at Google is not, because Google forbids automating that.

**While the environment is down**, CloudFront answers every `/api` request with a 503 and *The
backend is not running in this environment.* `e2e/live/backend-state.ts` asks once, before the
checks: the API checks then **skip** with that message, the frontend checks **still run**,
because the site outlives `down`, and the paused page is checked — which in turn skips while the
environment is up. The run summary says which of the two it was. Anything else
that is not an answer — a 502, a timeout — is a failure, not a skip.

**No retries.** A live check that passes on the second attempt has found something flaky in the
environment, which is worth a red run rather than a quiet green one.

## The signed-in scenarios

The same scenarios the Compose suite runs (`e2e/tests/login.spec.ts` and
`e2e/tests/attachments.spec.ts`), with
`e2e/playwright.live-signed-in.config.ts`, signed in as qa's Cognito test accounts
(`taskfest-test-one@example.com`, `taskfest-test-two@example.com`, #190) instead of the local
Keycloak ones. `e2e/support/identity.ts` is the only place the two differ: the button, how to fill
in the provider's login page — Cognito's classic hosted UI carries its form twice, so only the
visible one is addressed — and the accounts. One scenario runs in qa only: both accounts ask for
`/api/tasks` straight after each other, and each must get a `Miss from cloudfront` and its own list
(#120's check, automated).

- **Passwords are set per run and stored nowhere** (D2 on #141). The job assumes
  `taskfest-qa-live-test`, which may set the accounts' passwords and find the pool by name, nothing
  else. It trusts only jobs in the GitHub environment `qa-live-test` — not `qa`, which the deploy
  role trusts: this job runs npm and a browser, and must not be able to assume the deploy role. It
  sets a fresh random password on each account and runs the scenarios in the same step,
  so the passwords exist in that step's environment only, masked in the log.
- **Test data stays contained.** Before and after a run, `e2e/live/test-accounts.ts` signs in as
  each account and deletes all of its tasks. The accounts are used for nothing else, so that is
  safe — and a run aborted half-way is cleaned up by the next one. Files attached during a run
  (#204) are removed first, task by task, because a deleted task's files stay for the ten-minute
  undo window and count toward the five a user may have: two aborted runs in a row would
  otherwise fail the next on that limit. An upload abandoned half way is not listed, and the
  attachment sweep removes it within the hour.
- **While the environment is down, the job does not start**: the smoke job reports the backend's
  state, and there is nothing to sign in to.
- **One run at a time** (a concurrency group per environment): two would reset each other's
  passwords and clear each other's tasks.
- **Every scenario is recorded, and the newest run's videos are published**:
  [the newest live run](https://guhilling.github.io/ai-assisted-todolist/videos/), one video per
  scenario with its outcome, the release it ran against and a link to the run. The job names each
  video by its spec and title (`.github/scripts/collect-live-videos.py`) and uploads them as the
  artifact `live-videos-qa`, kept 30 days; `pages.yml` runs after every live run, release and
  frontend deploy, fetches the newest and publishes it under `videos/`. Failed runs are published
  too: a video of what went wrong is the useful one. A scenario that opens a second tab -- opening
  a PDF does -- has a video per tab, and the largest, its own page's, is the one published. Each
  video has a poster, the busiest of four frames (ffmpeg, in the job), and plays at half speed.
  The two scenarios that open a browser context per account record those through
  `e2e/support/recording.ts`, since a context a test opens itself records only when asked; of
  their two videos, one per account, the larger is published. A video shows the test accounts and their
  tasks, never a password: it goes into a password field as dots, and is new on every run.
- **No traces in this run**, unlike the Compose suite. A Playwright trace records what each `fill`
  typed and the body of every request, so the sign-in would put the run's passwords -- typed, and
  posted by Cognito's login page -- into the report a failed run uploads, which anyone signed in to
  GitHub can download from this public repository. The videos and the failure screenshots stand in
  for them. About
  2 MB per run, at Playwright's 800 x 450.

## When it runs

`live-tests.yml`, for qa only — prod has no live tests yet; the smoke checks first, then, if they
passed, the signed-in scenarios:

- **After every deploy to qa.** `deploy-frontend.yml` calls it once the new frontend is in place,
  which in a release is the last step, so both halves are new. `deploy-backend.yml` calls it when
  started by hand — a rollback, say — unless *Run the live tests afterwards* is unticked; not from
  a release, where the frontend deploy follows anyway.
- **By hand**, from the Actions tab.
- **On every pull request touching `e2e/`**, `e2e.yml` only *collects* them (`--list`), so a
  syntax or import error fails the pull request rather than the next deploy.

A failure fails the deploying run visibly. It rolls nothing back; whether to is a person's
decision. On failure the Playwright report is uploaded as an artifact.

Locally, against qa or anything else:

```sh
cd e2e
npm run test:live                                     # qa
LIVE_BASE_URL=https://example.test npm run test:live  # anywhere
```

## What it costs

A few minutes of GitHub Actions per deploy. The smoke checks make no AWS calls; the signed-in
scenarios make two `AdminSetUserPassword` calls and one `ListUserPools`, which Cognito does not
bill, and two monthly active users are far inside its free tier. The
checks are only meaningful while qa is **up** (about $2 a day, [cost](../deployment/cost.md));
they never bring it up.
