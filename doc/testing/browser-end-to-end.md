# Browser end-to-end

Playwright against the full containerised stack, so it covers what nothing else does: real
redirects, real httpd proxying, real cookies, real persistence.

```bash
# build both images, then:
docker compose -f deployment/docker/docker-compose.e2e.yml up -d --wait
cd e2e && npx playwright test
```

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

