#!/usr/bin/env bash
#
# Readiness probe for the backend container in docker/docker-compose.e2e.yml.
#
# It lives in a file rather than inline in the Compose healthcheck because an inline command
# gets split on whitespace into separate argv entries, which quietly turned the check into
# `bash -c exec` -- a no-op that always succeeded, so `up --wait` returned while the backend
# was still booting and Playwright met a 502.
#
# The backend serves TLS only (#247), and the image is UBI micro (deployment/jre-runtime): no
# curl, wget or nc, and bash's /dev/tcp speaks plain TCP. So the JRE asks, through a small class
# in the application's own jar, ReadinessProbe. Asking for the provider list proves the
# application is serving rather than merely that the port is open, and it needs no session.
set -eu

exec java -cp '/home/jboss/app/*' de.hilling.taskfest.health.ReadinessProbe \
    https://127.0.0.1:8443/api/auth/providers
