/**
 * Holds the library entry to the components that exist.
 *
 * `design-system.ts` re-exports by hand, so a component added under `components/` is invisible
 * to anything consuming the library until someone remembers the barrel. Nothing fails when that
 * is forgotten: the build succeeds, the app is unaffected, and the component is simply absent
 * from the published design system until a human notices a card missing.
 *
 * The components are enumerated with `import.meta.glob` rather than by reading the directory,
 * so the check needs no Node types -- `tsconfig.app.json` types the app against `vite/client`
 * alone, and this file is part of the app build. It also means the list is what the bundler
 * sees, which is the thing that actually has to end up in the barrel.
 *
 * The barrel is imported rather than parsed, so an export that is named but does not resolve
 * fails too, not only one that was never added.
 */
import { describe, expect, it } from 'vitest'
import * as designSystem from './design-system'

/** Every component module, by the name the barrel should export it as. */
function componentNames(): string[] {
  const modules = import.meta.glob('./components/*.tsx')
  return Object.keys(modules)
    .filter((path) => !path.endsWith('.test.tsx'))
    .map((path) => path.slice('./components/'.length, -'.tsx'.length))
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
