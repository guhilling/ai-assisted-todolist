# End-to-end stack

The same stack plus Keycloak, which is what the Playwright suite runs against. Both images
have to exist first:

```bash
cd backend && ./mvnw package -DskipTests -Dquarkus.container-image.build=true && cd ..
cd frontend && docker build -f docker/Dockerfile -t taskfest-frontend:e2e . && cd ..

docker compose -f deployment/docker/docker-compose.e2e.yml up -d --wait

cd e2e && npm ci && npx playwright install chromium && npx playwright test
```

Here the app is on `http://localhost:3000` with sign-in enabled against Keycloak on
`http://localhost:8082`, so you can also drive it by hand with the accounts above.

Always tear it down when finished — it binds the same ports as the other stacks:

```bash
docker compose -f deployment/docker/docker-compose.e2e.yml down -v
```

See [testing.md](../testing/index.md) for what the suite covers and how to run it interactively.

