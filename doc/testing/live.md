# Live tests

The other layers test the code. This one tests a **deployed environment** from the outside,
through CloudFront, the way a visitor reaches it — the part of qa that, until now, was checked by
hand after each change, and where things fail that cannot fail anywhere else (#141).

It has two parts, of which the first exists:

| Part | What it needs | Issue |
| --- | --- | --- |
| **Smoke checks** — everything that can be checked without signing in | nothing: no account, no AWS role, no secret | #142 |
| **The signed-in suite** — tasks, two users kept apart, sign-out | the Cognito test accounts | #144, after #143 and #190 |

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

## When it runs

`live-tests.yml`, for qa only — prod has no live tests yet:

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

Nothing beyond a minute or two of GitHub Actions per deploy: no AWS calls, no accounts. The
checks are only meaningful while qa is **up** (about $2 a day, [cost](../deployment/cost.md));
they never bring it up.
