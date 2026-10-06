# Containers and the local stack

## Compose files under `deployment/docker/`

**Decision.** Both Compose stacks moved from the repository root into `docker/`, each with
an explicit `name:`, and later into `deployment/docker/` when the AWS material arrived and
needed a sibling.

**Why.** Deployment artifacts get a home before AWS material arrives. The explicit project
names are load-bearing, and became more so with the second move: Compose otherwise derives
the project name from the containing directory, so without them the move would have
renamed the PostgreSQL volume and orphaned the existing one, and would have had the two
stacks treat each other's containers as strays. As written, the directory can move again
and the volumes do not notice.


## Compose probes live in scripts, not inline

**Decision.** A healthcheck or other multi-part command in a Compose file goes in a script
file next to it, mounted read-only, and is referenced by path:
`test: ["CMD", "bash", "/config/healthcheck.sh"]`. The same will apply to Kubernetes
`command`/`args` when that arrives.

**Why.** The first version of the backend healthcheck was written inline as a YAML folded
scalar. Compose split it on whitespace into separate argv entries, so what actually ran was
`bash -c exec` — a no-op that exits 0. The healthcheck therefore passed instantly and always,
`up --wait` returned while the backend was still booting, and the browser suite met a 502 from
nginx. The failure mode is the dangerous kind: a check that can never fail is indistinguishable
from a service that is always healthy.

**Also.** A script can be read, commented and run by hand; an inline one-liner with nested
quoting can be none of those.

**Cost.** One more file, and a volume mount that has to stay in step with it.

## The frontend is served by Red Hat's hardened httpd

**Decision.** The frontend image is `registry.access.redhat.com/hi/httpd:2` — Apache 2.4,
non-root on port 8080 — instead of `nginx:1.31-alpine`. The published port changes with it, so
the Compose files map `3000:8080`.

**Why.** It puts both images on a Red Hat maintained base, which is the point of the change.
The image is also hardened: it runs as `apache` rather than root, and it ships **no shell at
all**. That is worth knowing before debugging one — `podman exec ... sh` does not work, and
anything the runtime needs has to be `COPY`ed in, because `RUN` has nothing to run.

**What had to be carried across.** The nginx configuration was doing four things, and each has
an equivalent that is easy to get wrong:

| nginx | httpd | why it matters |
| --- | --- | --- |
| `root` + `index` | `DocumentRoot` | — |
| `try_files $uri /index.html` | `FallbackResource /index.html` | a deep link is a route, not a 404 |
| `proxy_set_header Host $http_host` | `ProxyPreserveHost On` | the backend builds `redirect_uri` from `Host`; without it sign-in returns the browser to the backend's port |
| `proxy_buffer_size 16k` and friends | `LimitRequestFieldSize 32768` | the chunked session cookie comes back as one long `Cookie` header |

The last one is headroom rather than a fix: measured, the cookies total about 5.2 KB against
Apache's 8190-byte default, so they fit today. It is raised because the size depends on how many
claims the provider puts in the token, and the failure would be a 400 on every request after
sign-in — a symptom that points nowhere near its cause.

**Verified rather than assumed.** The whole end-to-end suite passes against the new images,
including a real Keycloak sign-in through the proxy, which is what exercises `ProxyPreserveHost`.
Separately checked by hand: a deep link returns the app, a real asset still serves, and an
unknown `/api` path returns the *backend's* 404 rather than the index page, which is what
confirms `ProxyPass` is matched before the fallback.

**Cost.** `hi/httpd:2` is a moving major tag, so Renovate will only raise a pull request when a
`3` appears. Pinning it by digest would make it as reproducible as the backend's base, at the
price of a pull request every time the image is rebuilt upstream; that is a separate decision
and has not been taken.

## The backend runs on our own jre-runtime: Temurin's JRE on UBI micro

**Decision** (#66, Gunnar). The backend image is built by Jib onto `quay.io/ghilling/jre-runtime`,
an image of our own: the full Eclipse Temurin JRE copied onto Red Hat **UBI 10 micro**. It is
built from `deployment/jre-runtime/Containerfile` by `publish-jre-runtime.yml`, for amd64 and
arm64, and is named generically because it is meant to be reused in other projects.

**Why.** Scanners reported a "CVE flood" for the backend, nearly all of it in the base image's OS
packages. Temurin's UBI image is UBI *minimal* with about 130 packages a JVM never uses —
binutils, systemd, dbus, curl, wget, gnupg, microdnf, fonts — 152 in all; UBI micro has 24. The
JRE needs only glibc from the OS and brings its own CA certificates and zlib. Quay's scanner
counted 32 High findings in the old base, all without a fix and none relevant to a Java service
(`mount` with `user` fstab entries, `nsenter`, OpenSSL's QUIC stack); with UBI micro the packages
behind them are simply not there. The compressed base also drops from 136 to 70 MB, which every
`env.sh up` and every deployment pulls.

**Measured before deciding**, on 2026-10-06: Temurin on Ubuntu, Alpine, Red Hat's
`ubi10/openjdk-25-runtime`, distroless Java 25 and Chainguard's JRE, plus two prototypes. A
prototype on UBI micro passed the whole Playwright suite against the `prod` profile.

**Rejected:**
- *A `jlink`'ed JRE* (prototyped, passed too): only 11 MB smaller to pull, because the JRE's own
  compression already does what gzip would, for a module list that would break at runtime,
  silently, whenever a dependency started needing another module. Possible later, nothing else
  would have to change.
- *A native image*: ruled out in the issue for its build times and restrictions in CI/CD.
- *Distroless* moves the noise to Debian's unfixed findings; *Alpine* swaps glibc for musl;
  *Chainguard*'s free tier only has `latest`, which the pinning rule in `backend/CLAUDE.md` forbids;
  *Red Hat's openjdk runtime* is UBI minimal again.
- *A Dockerfile build of the backend instead of Jib with a base of our own*: it would reverse "no
  Dockerfiles under `backend/`", which was deliberate.

**Consequence.** UBI micro has bash and coreutils but no package manager, no `grep` and no `curl`:
anything that runs inside the container — a health check script, a debugging session — has to make
do with those.
