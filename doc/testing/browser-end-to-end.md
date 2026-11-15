# Browser end-to-end

Playwright against the full containerised stack, so it covers what nothing else does: real
redirects, real httpd proxying, real cookies, real persistence.

```bash
# build both images, then:
docker compose -f deployment/docker/docker-compose.e2e.serverless.yml up -d --wait
cd e2e && npx playwright test
```

In CI it runs on an amd64 runner (`e2e-serverless.yml`). Until #559 it also ran on arm64, against
the Quarkus backend's stack, which is what showed the images working on Apple silicon (#249); the
Lambda functions themselves are built for arm64 and tested by Serverless CI.

Full setup is in [local-development.md](../local-development/index.md). Useful flags while
debugging: `--headed`, `--debug`, and `npx playwright show-report` after a failure.

The suite is serial (`workers: 1`) because all tests share one database, and each account
gets its own `browser.newContext()` because Keycloak's SSO session outlives the app's
sign-out.

Two things in here exist because of failures that only a real stack produces:

- **`up --wait` needs the backend's readiness check**, the `backend-ready` service in
  `docker-compose.e2e.serverless.yml`. Without one, Compose calls a container ready the moment it
  runs, and Playwright met a 502 from httpd while the backend was still starting. The Quarkus
  backend took over thirty seconds; its probe was a mounted script rather than an inline command,
  because an inline one is split on whitespace into separate argv entries, and the first version
  became `bash -c exec`, a no-op that always succeeded.
- **A reload has to wait for the save it is testing.** Ticking a task and deleting one are
  both optimistic — the board updates before the server answers — so `page.reload()` fired
  while the request was still in flight and cancelled it. The specs now await the `PUT` and
  `DELETE` response before reloading. It passed against a warm backend, where the request
  takes milliseconds, and failed against a cold one.

## The identity fixture

`e2e/support/identity.ts` decides who the scenarios sign in as: the local Keycloak accounts
`gunnar` and `lasse` by default, or — with `E2E_IDENTITY=cognito` — qa's test accounts, with the
passwords the live-test job has just set (#144). It holds everything that differs between the two:
the sign-in button, how to fill in the provider's login page, and the two accounts. The scenarios in
`tests/login.spec.ts` and `tests/attachments.spec.ts` are the same for both; the one that checks
CloudFront's cache skips against the Compose stack, which has none. See [Live tests](live.md).

## Attachments

`tests/attachments.spec.ts` (#204) attaches a PDF and an image in the editor, waits for the image to
be decoded from storage, opens the PDF in its large preview (#586) and compares the bytes its
Download saves with those uploaded, then removes both and
checks after a reload that they are gone. It is the one test of the browser's own path to S3, which
the backend never sees: the PUT to a presigned link -- cross-origin, so the bucket's CORS rule must
allow it, and with the size and type the link was signed for -- and the GETs of a preview and an
opened file. Against the Compose stack S3 is LocalStack with signature checks on; against qa, the
environment's real bucket. Download fetches the file from storage itself, which the bucket's CORS
rule must allow as it does the upload.

`tests/thumbnails.spec.ts` (#236) attaches an 800 x 600 photo of noise -- noise, so the file is over the 64 KB below which an
image is shown as it is -- and checks that the row shows a
128 px thumbnail of it, which only a real browser's canvas can make, and that its large preview
and its Download are the photo itself.

`tests/shortcut-badge.spec.ts` (#386) signs in on a desktop and in Chromium's phone emulation, and
checks the `n` badge on **Add a task** is shown on the one and left out on the other: jsdom applies
no media query, so only a real browser can tell. The live run leaves it out: a deployment cannot
change a stylesheet.

