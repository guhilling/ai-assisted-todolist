/**
 * What the website's modules expect of their bundler, declared for the app's type check (#267).
 *
 * `web.ts` imports DOM-free modules from `frontend/`, but their types reach `frontend/src/api.ts`,
 * which reads Vite's `import.meta.env`. Nothing of it runs in the app; only the types are checked.
 */
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly DEV: boolean
  readonly [key: string]: string | boolean | undefined
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
