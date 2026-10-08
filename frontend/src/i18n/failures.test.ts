import { describe, expect, it } from 'vitest'
import { ContractBreachError, RequestError } from '../api'
import { describeFailure } from './failures'
import { de, en } from './messages'

describe('what the banner says about a failure', () => {
  it('words a failed request in the language the app speaks', () => {
    expect(describeFailure(new RequestError('createTask'), 'fallback', en, 'en')).toBe('Unable to create task.')
    expect(describeFailure(new RequestError('createTask'), 'fallback', de, 'de')).toBe(
      'Die Aufgabe konnte nicht angelegt werden.',
    )
  })

  it('says which answer broke the contract, and how, in either language', () => {
    const breach = new ContractBreachError('task', 'idNotInteger')

    expect(describeFailure(breach, 'fallback', en, 'en')).toBe(
      'The backend sent a task that does not match its own API contract: its id is not an exact integer.',
    )
    expect(describeFailure(breach, 'fallback', de, 'de')).toBe(
      'Die Antwort des Backends (eine Aufgabe) passt nicht zu seinem eigenen API-Vertrag: ihre ID ist keine exakte Ganzzahl.',
    )
  })

  it('words a breach without a detail as well', () => {
    expect(describeFailure(new ContractBreachError('signInOptions'), 'fallback', en, 'en')).toBe(
      'The backend sent the sign-in options that does not match its own API contract.',
    )
  })

  it("keeps another error's own message on an English page", () => {
    expect(describeFailure(new Error('Network is down.'), 'fallback', en, 'en')).toBe('Network is down.')
  })

  it("does not show another error's own message on a page in another language", () => {
    // "Failed to fetch", "Unexpected token < in JSON": English or the browser's, never the page's.
    expect(describeFailure(new TypeError('Failed to fetch'), 'Unerwarteter Fehler.', de, 'de')).toBe('Unerwarteter Fehler.')
  })

  it('falls back for something thrown that is no error at all', () => {
    expect(describeFailure('not an Error', 'fallback', en, 'en')).toBe('fallback')
  })
})
