# End-to-end stack

The same stack plus Keycloak and S3, which is what the Playwright suite runs against. Both images
have to exist first:

```bash
cd backend && ./mvnw package -DskipTests -Dquarkus.container-image.build=true && cd ..
cd frontend && docker build -f docker/Dockerfile -t taskfest-frontend:e2e . && cd ..

docker compose -f deployment/docker/docker-compose.e2e.yml up -d --wait

cd e2e && npm ci && npx playwright install chromium && npx playwright test
```

Here the app is on `http://localhost:3000` with sign-in enabled against Keycloak on
`http://localhost:8082`, so you can also drive it by hand with the accounts above.

**S3 is LocalStack** (#204), with the bucket `taskfest-attachments` and the same CORS rule as in
AWS, created by `e2e/localstack-init.sh`, and signature checks switched on as AWS has them. It sits
at `http://s3.localhost:4566`, one address for both sides: the backend signs upload and download
links for it, and the browser follows them. The browser resolves every `*.localhost` to 127.0.0.1,
where the port is published; inside the network, `s3.localhost` is an alias of the LocalStack
container. Two names, as with Keycloak, would mean links signed for a host the browser asks
another for, and a signature that no longer matches.

**With Podman, build the frontend image with `podman build`.** A Docker CLI whose builder uses the
`docker-container` driver keeps the result in its build cache without loading it, and the stack
then quietly starts whatever older `taskfest-frontend:e2e` it finds.

Always tear it down when finished — it binds the same ports as the other stacks:

```bash
docker compose -f deployment/docker/docker-compose.e2e.yml down -v
```

See [testing.md](../testing/index.md) for what the suite covers and how to run it interactively.

