/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Vite configuration for the dev server, the production bundle and the Vitest run.
 *
 * See https://vite.dev/config/ for the full option reference.
 */
export default defineConfig({
  plugins: [react()],
  server: {
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
      exclude: ['src/main.tsx', 'src/setupTests.ts', 'src/**/*.test.{ts,tsx}'],
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
