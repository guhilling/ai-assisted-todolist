#!/usr/bin/env bash
#
# Liveness probe for the backend container in docker/docker-compose.e2e.yml: is its TLS port open.
#
# It lives in a file rather than inline in the Compose healthcheck because an inline command
# gets split on whitespace into separate argv entries, which quietly turned the check into
# `bash -c exec` -- a no-op that always succeeded.
#
# The backend serves TLS only (#247), and the image is UBI micro (deployment/jre-runtime): no
# curl, wget or nc, and bash's /dev/tcp speaks plain TCP. So this only checks that the port
# accepts a connection; whether the application is serving -- asked over TLS -- is the
# backend-ready container's check, which the frontend waits for.
set -eu

exec 3<>/dev/tcp/127.0.0.1/8443
