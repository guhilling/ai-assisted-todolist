#!/usr/bin/env bash
#
# Readiness probe for the backend container in docker/docker-compose.e2e.yml.
#
# It lives in a file rather than inline in the Compose healthcheck because an inline command
# gets split on whitespace into separate argv entries, which quietly turned the check into
# `bash -c exec` -- a no-op that always succeeded, so `up --wait` returned while the backend
# was still booting and Playwright met a 502.
#
# The image is UBI micro (deployment/jre-runtime): no curl, wget or nc, and no grep either, so
# the request goes over bash's /dev/tcp and the status line is matched by bash itself. Asking
# for the provider list proves the application is serving rather than merely that the port is
# open, and it needs no session.
set -eu

exec 3<>/dev/tcp/127.0.0.1/8080
printf 'GET /api/auth/providers HTTP/1.1\r\nHost: localhost:8080\r\nConnection: close\r\n\r\n' >&3
read -r status <&3
[[ $status =~ ^HTTP/[0-9.]+\ 200([^0-9]|$) ]]
