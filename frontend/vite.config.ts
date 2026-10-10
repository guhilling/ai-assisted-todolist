/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Vite configuration for the dev server, the production bundle and the Vitest run.
 *
 * See https://vite.dev/config/ for the full option reference.
 */
export default defineConfig({
  // The mobile app's files are read as text only, never compiled: their tsconfig extends Expo's,
  // which only the app installs. node_modules is plugin-react's own default exclusion.
  plugins: [react({ exclude: [/\/node_modules\//, /\/mobile\/src\//] })],
  oxc: { exclude: [/\.js$/, /\/mobile\/src\//] },
  server: {
    // IPv4 explicitly. Left to itself Vite binds whatever `localhost` resolves to in Node, which
    // can be ::1 alone -- while a browser that resolves localhost to 127.0.0.1 first then finds
    // nothing listening and shows a blank "can't connect".
    host: '127.0.0.1',
    // Fail rather than drift to 5174 when 5173 is taken: the sign-in redirects and the docs
    // name 5173, and a silently moved dev server looks exactly like one that never started.
    strictPort: true,
    // The catalogue test reads the mobile app's code too, which shares the website's texts
    // (`src/i18n/messages.test.ts`). Only Vitest needs it; the dev server serves nothing outside.
    ...(process.env.VITEST ? { fs: { allow: ['.', '../mobile/src'] } } : {}),
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        // The backend builds the OIDC redirect_uri from the Host header. Rewriting it would
        // send the browser to :8080 after sign-in instead of back to the Vite dev server.
        changeOrigin: false,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // Without an explicit include the report covers whatever the tests happened to import,
      // which let App.css in with empty counters and left main.tsx out altogether.
      include: ['src/**/*.{ts,tsx}'],
      // main.tsx only mounts the app: there is nothing in it to assert that the e2e suite
      // does not already prove by the page rendering at all.
      // src/generated is written by `npm run generate:api`. Its correctness is the schemas' and
      // Ajv's, tested through api.ts rather than directly, and declaration files have nothing
      // to count anyway.
      exclude: [
        'src/main.tsx',
        'src/setupTests.ts',
        'src/generated/**',
        'src/**/*.test.{ts,tsx}',
      ],
      // The suite is at 100% on all four. The gate sits just below so a genuinely
      // defensive branch does not fail the build on the day it is written -- raise these
      // when coverage rises, never lower them to fit a change.
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 95,
        statements: 95,
      },
    },
  },
})
