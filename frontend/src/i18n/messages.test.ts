/**
 * The message catalogues stay complete and lean (#203).
 *
 * Complete is the compiler's job: German is typed as English's shape, so a missing key fails the
 * build. Lean is this test's: every entry has to be used, by its full path, in the code -- so a
 * text nobody shows any more is deleted rather than translated forever. The sources are read
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

/**
 * How the code uses an entry, by the group it is in.
 *
 * By its full path -- `addRow.cancel`, not just `cancel`, which every other `.cancel` would have
 * vouched for -- unless the group is looked up by a key the code computes:
 * - groups typed as a `Record` over a type the code owns (`DueBucket`, `TaskImportance`, `api.ts`'s
 *   keys) hold exactly that type's keys, which the compiler checks; the group is used if it is
 *   indexed anywhere;
 * - `failures` is indexed too, by keys the code passes as string literals, so each must appear so;
 * - `dates` is handed to `dates.ts` whole, which reads it as `words`.
 */
function usage(path: string): RegExp {
  const parts = path.split('.')
  const leaf = parts.pop()!
  const group = parts.join('.')
  const indexedByOwnedType = ['sections', 'importance.levels', 'errors', 'contract.subjects', 'contract.details']
  if (indexedByOwnedType.includes(group)) {
    return new RegExp(`\\.${group.replace('.', '\\.')}\\[`)
  }
  if (group === 'failures') {
    return new RegExp(`'${leaf}'`)
  }
  if (group === 'dates') {
    return new RegExp(`\\bwords\\.${leaf}\\b`)
  }
  return new RegExp(`\\.${path.replace(/\./g, '\\.')}\\b`)
}

describe('the message catalogues', () => {
  it('have the same entries in every language', () => {
    expect(leaves(de)).toEqual(leaves(en))
  })

  it('hold nothing the app no longer uses', () => {
    const code = Object.values(sources).join('\n')
    const unused = leaves(en).filter((path) => !usage(path).test(code))

    expect(unused).toEqual([])
  })
})

describe('the texts that depend on a value', () => {
  it('count in each language', () => {
    expect(en.undo.deleted(1)).toBe('Task deleted')
    expect(en.undo.deleted(3)).toBe('3 tasks deleted')
    expect(de.undo.deleted(1)).toBe('Aufgabe gelöscht')
    expect(de.undo.deleted(3)).toBe('3 Aufgaben gelöscht')
    expect(de.dates.inWeeks(1)).toBe('In 1 Woche')
    expect(de.dates.inWeeks(2)).toBe('In 2 Wochen')
    expect(de.dates.daysAgo(3)).toBe('vor 3 Tagen')
    expect(de.completed.title(4)).toBe('Erledigt (4)')
  })

  it('put a task description where each language puts it', () => {
    expect(de.editor.label('Pass erneuern')).toBe('„Pass erneuern“ bearbeiten')
    expect(de.row.markDone('Pass erneuern')).toBe('„Pass erneuern“ als erledigt markieren')
    expect(de.row.actions('Pass erneuern')).toBe('Aktionen für „Pass erneuern“')
  })

  it('name a paused environment, or say this one', () => {
    expect(de.paused.message('QA')).toBe('Die Umgebung QA ist gerade pausiert.')
    expect(de.paused.message(null)).toBe('Diese Umgebung ist gerade pausiert.')
  })

  it('word a broken contract with and without a detail', () => {
    expect(de.contract.message('eine Aufgabe')).toBe('Die Antwort des Backends (eine Aufgabe) passt nicht zu seinem eigenen API-Vertrag.')
    expect(de.contract.message('eine Aufgabe', 'sie ist keine Liste')).toBe(
      'Die Antwort des Backends (eine Aufgabe) passt nicht zu seinem eigenen API-Vertrag: sie ist keine Liste.',
    )
  })

  it('sign in and name the version in each language', () => {
    expect(de.signedOut.signInWith('Google')).toBe('Mit Google anmelden')
    expect(de.footer.version('0.8.0')).toBe('Version 0.8.0')
  })
})

