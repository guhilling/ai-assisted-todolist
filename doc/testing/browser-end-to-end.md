# Browser end-to-end

Playwright against the full containerised stack, so it covers what nothing else does: real
redirects, real httpd proxying, real cookies, real persistence.

```bash
# build both images, then:
docker compose -f deployment/docker/docker-compose.e2e.yml up -d --wait
cd e2e && npx playwright test
```

In CI it runs twice, on an amd64 and on an arm64 runner, each with images built natively for it
(#249): the arm64 run is what shows the images work on Apple silicon and Graviton.

Full setup is in [local-development.md](../local-development/index.md). Useful flags while
debugging: `--headed`, `--debug`, and `npx playwright show-report` after a failure.

The suite is serial (`workers: 1`) because all tests share one database, and each account
gets its own `browser.newContext()` because Keycloak's SSO session outlives the app's
sign-out.

Two things in here exist because of failures that only a real stack produces:

- **`up --wait` needs the backend healthcheck** in `docker-compose.e2e.yml`. Without one,
  Compose calls a container ready the moment it runs, and the backend takes over thirty
  seconds to start — so Playwright met a 502 from httpd. The probe lives in
  `e2e/backend-healthcheck.sh` rather than inline, because an inline command is split on
  whitespace into separate argv entries: the first version became `bash -c exec`, a no-op
  that always succeeded, which looks exactly like a service that is always healthy.
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
be decoded from storage, opens the PDF and compares the bytes that come back, then removes both and
checks after a reload that they are gone. It is the one test of the browser's own path to S3, which
the backend never sees: the PUT to a presigned link -- cross-origin, so the bucket's CORS rule must
allow it, and with the size and type the link was signed for -- and the GETs of a preview and an
opened file. Against the Compose stack S3 is LocalStack with signature checks on; against qa, the
environment's real bucket. A headless browser downloads a PDF instead of showing it, so the link is
taken from the new tab's request and fetched by the test.

`tests/thumbnails.spec.ts` (#236) attaches an 800 x 600 photo of noise -- noise, so the file is over the 64 KB below which an
image is shown as it is -- and checks that the row shows a
128 px thumbnail of it, which only a real browser's canvas can make, and that opening it still
opens the photo.

