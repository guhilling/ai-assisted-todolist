# Troubleshooting

**Testcontainers finds no container runtime.** The Go backend's store and file tests start
DynamoDB Local and LocalStack through Testcontainers, which needs a Docker-compatible socket. With
Podman on macOS, start the machine, and leave `DOCKER_HOST` unset:

```bash
podman machine start
unset DOCKER_HOST
```

Podman's installer sets up `podman-mac-helper`, which makes `/var/run/docker.sock` on the Mac
point at the machine, and the machine has a `/var/run/docker.sock` of its own. Testcontainers
uses that path by default, and it is the right one because the path is the same on both sides.

**Every Testcontainers test fails with `Container startup failed for image
testcontainers/ryuk`.** `DOCKER_HOST` points at the machine's socket under `/var/folders/…`.
Testcontainers mounts that same path into its Ryuk clean-up container, but the path exists only
on the Mac, not inside the VM, so Ryuk never reports that it has started. `unset DOCKER_HOST`
fixes it. Earlier versions of this page recommended exactly that export; if it is in your
shell profile, take it out. If `/var/run/docker.sock` is missing on the Mac, run
`sudo podman-mac-helper install` and restart the machine. With Podman, run the Go tests with
`TESTCONTAINERS_RYUK_DISABLED=true` as well (`serverless/CLAUDE.md` says why).

**The Keycloak container starts and is immediately killed (exit 137).** It has run out of
memory — the default Podman machine is too small for it. Give the machine more:

```bash
podman machine stop
podman machine set --memory 5120 --cpus 4
podman machine start
```

**`npm run dev` says it is ready, but `http://localhost:5173` cannot connect.** Vite used to
bind whatever Node resolved `localhost` to, which can be IPv6 `[::1]` alone, while the browser
resolved `localhost` to `127.0.0.1` first and found nothing there. `vite.config.ts` now binds
`127.0.0.1` explicitly. With `strictPort` it also refuses to start when 5173 is taken, instead of
moving to 5174 without saying so. If it says the port is in use, an earlier dev server is still
running: `lsof -nP -iTCP:5173 -sTCP:LISTEN` names it.

**`docker build` succeeds but Compose cannot find the image.** With a buildx
`docker-container` driver the build result stays in the build cache rather than in the
image store; add `--load` to the `docker build` command.

**Port 8080, 8000, 8082, 8333, 5173 or 3000 is already in use.** Usually the stack is still up,
or a `go run ./cmd/api` from an earlier session. `docker compose -f
deployment/docker/docker-compose.e2e.serverless.yml down -v`, then check for a stray server with
`lsof -nP -iTCP:<port> -sTCP:LISTEN`.

**Signed in, but every request comes back 401.** Usually a `taskfest_session` cookie left over from
a previous run of the stack, whose in-memory table and Keycloak realm no longer exist. Clear cookies
for `localhost:5173` (or `:3000`) and sign in again.

**Sign-in lands you on port 8080 instead of returning to the app.** A proxy is rewriting
the `Host` header. Check `changeOrigin: false` in `frontend/vite.config.ts`, or
`ProxyPreserveHost On` in `frontend/docker/httpd.conf`.

**400 on every request after signing in.** All the site's cookies, Keycloak's included, come
back in one `Cookie` header. If it has outgrown Apache's limit, raise
`LimitRequestFieldSize` in `frontend/docker/httpd.conf` — it is already set well above
what the current tokens need, so this means the provider started issuing larger ones.

**A deep link 404s instead of loading the app.** `FallbackResource /index.html` is missing
from `frontend/docker/httpd.conf`, or the path is being served from outside the document
root.
