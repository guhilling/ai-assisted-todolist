# frontend

The React 19 + TypeScript single-page app, built with Vite and served in production by
nginx. One screen: the sign-in cards when signed out, the task board when signed in.

```bash
npm install
npm run dev             # http://localhost:5173, proxies /api to the backend on :8080
npm run test            # Vitest
npm run test:coverage   # with the lcov report SonarCloud consumes
npm run lint            # oxlint
npm run build           # tsc -b && vite build
```

The backend has to be running for anything beyond the shell to work — see
[../doc/local-development.md](../doc/local-development.md).

Conventions for working here — TDD, strict TypeScript, linting, TSDoc — are in
[CLAUDE.md](CLAUDE.md). The app talks to the backend through a session cookie and never
holds a token; [../doc/authentication.md](../doc/authentication.md) explains what that
implies for the sign-in link and for `fetch`.

`docker/Dockerfile` builds the production image. Its nginx config must keep forwarding the
original `Host` header and its enlarged proxy buffers, both of which sign-in depends on.
