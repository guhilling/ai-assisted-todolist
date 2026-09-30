/**
 * Holds the library entry to the components that exist.
 *
 * `design-system.ts` re-exports by hand, so a component added under `components/` is invisible
 * to anything consuming the library until someone remembers the barrel. Nothing fails when that
 * is forgotten: the build succeeds, the app is unaffected, and the component is simply absent
 * from the published design system until a human notices a card missing.
 *
 * The check imports the barrel rather than reading its text, so it fails on an export that is
 * named but does not resolve as well as on one that was never added.
 */
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as designSystem from './design-system'

/** Every component module under `components/`, by the name the barrel should export it as. */
function componentNames(): string[] {
  // Resolved from the Vitest root rather than from `import.meta.url`: under the test
  // transform that URL is not a file: URL, and every npm script here runs from `frontend/`.
  const directory = resolve(process.cwd(), 'src/components')
  return readdirSync(directory)
    .filter((file) => file.endsWith('.tsx') && !file.endsWith('.test.tsx'))
    .map((file) => file.slice(0, -'.tsx'.length))
    .sort()
}

describe('the library entry', () => {
  it('exports every component the board is built from', () => {
    const missing = componentNames().filter((name) => !(name in designSystem))

    expect(missing).toEqual([])
  })

  it('finds the components at all, so an empty list cannot pass by accident', () => {
    expect(componentNames().length).toBeGreaterThan(0)
  })
})
