/**
 * Holds the generated validators to what the dev server can load.
 *
 * Vite's dev server hands files under `src/` to the browser as they are, so a CommonJS
 * `require` in one is a `ReferenceError` the moment the page imports it -- the board stays
 * blank. The production build converts such a call, which is why the bundle, the end-to-end
 * suite and qa all kept working while `npm run dev` showed nothing. Ajv's standalone output
 * emitted exactly that for its string-length helper, even in ESM mode.
 */
import { describe, expect, it } from 'vitest'
import validators from './generated/validators.js?raw'

describe('the generated validators', () => {
  it('are a plain ES module, with nothing the browser cannot run as served', () => {
    expect(validators).not.toMatch(/\brequire\(/)
  })

  it('import nothing at all, so ajv stays a build-time dependency', () => {
    expect(validators).not.toMatch(/^\s*import\s/m)
  })
})
