/**
 * The message catalogues stay complete and lean (#203).
 *
 * Complete is the compiler's job: German is typed as English's shape, so a missing key fails the
 * build. Lean is this test's: every entry's name has to appear in the code that uses the catalogue,
 * so a text nobody shows any more is deleted rather than translated forever. The sources are read
 * through Vite, so the check needs no Node types.
 */
import { describe, expect, it } from 'vitest'
import { de, en } from './messages'

const sources = import.meta.glob(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}', '!../i18n/messages.ts', '!../generated/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/** Every leaf of a catalogue, as `group.leaf` or `group.inner.leaf`. */
function leaves(tree: object, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'object' && value !== null ? leaves(value, `${prefix}${key}.`) : [`${prefix}${key}`],
  )
}

describe('the message catalogues', () => {
  it('have the same entries in every language', () => {
    expect(leaves(de)).toEqual(leaves(en))
  })

  it('hold nothing the app no longer uses', () => {
    const code = Object.values(sources).join('\n')
    const unused = leaves(en).filter((path) => {
      const name = path.split('.').pop()!
      // Used as `messages.group.name`, `words.name`, or as a key: `'name'` or `name:`.
      return !new RegExp(`\\.${name}\\b|'${name}'|\\b${name}:`).test(code)
    })

    expect(unused).toEqual([])
  })
})
