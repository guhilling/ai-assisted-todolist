/// <reference types="vite/client" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * The library build: the board's components as an importable package, not as an app.
 *
 * Separate from `vite.config.ts` because the two produce different things from the same
 * source. That one bundles an application into `dist/`; this one bundles `design-system.ts`
 * into `dist-ds/` with React left external, so a host that already has React renders these
 * components rather than a second copy of the framework.
 *
 * `cssCodeSplit: false` puts every imported stylesheet into one file, which is what a
 * consumer wants to link -- the tokens and the class vocabulary in a single import.
 *
 * `cssFileName` pins that file's name. Vite would otherwise take it from the package name in
 * `package.json`, so renaming the package would silently move the stylesheet out from under
 * the `./styles.css` export, Frontend CI and `.design-sync/config.json`.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist-ds',
    emptyOutDir: true,
    // The app's favicon and icon sprite are the app's, not the library's. Neither the
    // components nor the stylesheet reference them -- checked, not assumed.
    copyPublicDir: false,
    cssCodeSplit: false,
    lib: {
      entry: 'src/design-system.ts',
      formats: ['es'],
      fileName: () => 'index.js',
      cssFileName: 'frontend',
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime'],
    },
  },
})
