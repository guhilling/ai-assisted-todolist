# Sending to the monitoring server

The trial of [#508](https://github.com/guhilling/ai-assisted-todolist/issues/508): the backend's
metrics and logs, from a local stack, in VictoriaMetrics and VictoriaLogs on the shared monitoring
server, with a Perses dashboard over both. The server and its stack are in the private repository
[guhilling/monitoring](https://github.com/guhilling/monitoring), whose
[server page](https://github.com/guhilling/monitoring/blob/main/doc/server.md) says how the server
is set up. Nothing in AWS sends there yet.

## Running it

The server's ports listen on its loopback only, so first open the SSH tunnel; it needs the server's
SSH alias and key, which only Gunnar has:

```sh
ssh -f -N -L 8080:localhost:8080 -L 8428:localhost:8428 -L 9428:localhost:9428 monitoring.hetzner
```

Then start the [end-to-end stack](end-to-end-stack.md) with `docker-compose.monitoring.yml` laid
over it:

```sh
docker compose -f deployment/docker/docker-compose.e2e.yml \
  -f deployment/docker/docker-compose.monitoring.yml up -d --wait
```

Perses is at <http://localhost:8080>, project *TaskFest*, dashboard *Overview*, environment
`local`. The overlay works over any stack with a `backend` service; the end-to-end stack is the one
that starts with nothing to configure.

## What it adds

| Container | Does |
| --- | --- |
| `vmagent` | Scrapes the backend's `/q/metrics` every 30 s over TLS (its self-signed certificate, not verified) and remote-writes to VictoriaMetrics, labelled `project=taskfest`, `env=local` |
| `fluent-bit` | AWS's build of Fluent Bit. Takes the backend's log lines on TCP port 5170 and posts them to VictoriaLogs' JSON lines API, with `project` and `env` added; a stream is one logger |

- **The backend logs twice:** to the console as always, and the same JSON to Fluent Bit through
  Quarkus' socket handler (`QUARKUS_LOG_SOCKET_*`, set by the overlay only). The image is
  unchanged.
- **The same configuration as qa.** Both collectors read `deployment/monitoring/`, which the
  backend task in AWS uses too (`monitoring.tf`); only environment variables differ: where the
  server is, TLS, basic auth and the `env` label ([observability](../deployment/observability.md)).
- **Why two collectors.** The backend answers `/q/metrics` in OpenMetrics, which Fluent Bit's
  Prometheus scraper cannot read, so `vmagent` takes the metrics. Fluent Bit takes the logs because
  FireLens, what would ship them from ECS, is Fluent Bit too.
- **The tunnel's end, seen from a container,** is `host.containers.internal` under Podman. Docker
  Desktop names it `host.docker.internal`: set `MONITORING_HOST=host.docker.internal` there.
- **No percentiles from the metrics:** the backend publishes no histogram buckets, so the
  dashboard's percentiles come from the access log's `durationMs`.
