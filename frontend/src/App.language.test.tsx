/**
 * The board in German (#203): a remembered choice wins over the browser's, the switch is on every
 * page, and a failure already on screen is translated with the rest.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { pausedEnvironment, stubApi } from './testing/api'
import { ALICE, COGNITO, GOOGLE, isoIn, task } from './testing/board'

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('in German', () => {
  // The visitor's remembered choice, which wins over the browser's preference (i18n/language.ts).
  beforeEach(() => localStorage.setItem('taskfest.language', 'de'))
  afterEach(() => {
    localStorage.removeItem('taskfest.language')
    document.documentElement.lang = 'en'
  })

  it('speaks German on the signed-out page, and says so to screen readers', async () => {
    globalThis.fetch = stubApi({ providers: { enabled: true, providers: [COGNITO, GOOGLE] } }) as unknown as typeof fetch
    render(<App />)

    expect(await screen.findByRole('link', { name: 'Mit TaskFest test account anmelden' })).toBeInTheDocument()
    expect(screen.getByText('Deine eigene Liste – privat für alle, die sich anmelden.')).toBeInTheDocument()
    // Google's official button exists in English only (D3 on #203).
    expect(screen.getByRole('link', { name: 'Sign in with Google' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Impressum' })).toBeInTheDocument()
    // The German privacy policy, not the English one (D4 on #203).
    expect(screen.getByRole('link', { name: 'Datenschutz' })).toHaveAttribute(
      'href',
      'https://taskfest-docs.cloud.hilling.de/doc/datenschutz.html',
    )
    expect(document.documentElement.lang).toBe('de')
  })

  it('speaks German on the paused page', async () => {
    globalThis.fetch = pausedEnvironment('QA')
    render(<App />)

    expect(await screen.findByText('Die Umgebung QA ist gerade pausiert.')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Ein Comic-Panda, der an Bambus kaut' })).toBeInTheDocument()
  })

  it('speaks German on the board, due dates and importance included', async () => {
    globalThis.fetch = stubApi({
      me: ALICE,
      tasks: [task({ id: 7, description: 'Pass erneuern', dueDate: isoIn(1), importance: 'HIGH' })],
    }) as unknown as typeof fetch
    render(<App />)

    expect(await screen.findByRole('button', { name: 'Aufgabe hinzufügen' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Morgen' })).toBeInTheDocument()
    expect(screen.getByLabelText('„Pass erneuern“ als erledigt markieren')).toBeInTheDocument()
    expect(screen.getByText('Hoch')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Konto' }))
    expect(screen.getByRole('link', { name: 'Abmelden' })).toBeInTheDocument()
  })

  it('reports a failure in German', async () => {
    globalThis.fetch = stubApi({ me: ALICE, tasks: 'server-error' }) as unknown as typeof fetch
    render(<App />)

    expect(await screen.findByText('Die Aufgaben konnten nicht vom Backend geladen werden.')).toBeInTheDocument()
  })
})

describe('the language switch', () => {
  afterEach(() => {
    localStorage.removeItem('taskfest.language')
    document.documentElement.lang = 'en'
  })

  it('translates a failure already on screen', async () => {
    globalThis.fetch = stubApi({ me: ALICE, tasks: 'server-error' }) as unknown as typeof fetch
    render(<App />)
    await screen.findByText('Unable to load tasks from the backend.')

    fireEvent.click(screen.getByRole('button', { name: 'Deutsch' }))

    expect(await screen.findByText('Die Aufgaben konnten nicht vom Backend geladen werden.')).toBeInTheDocument()
  })

  it('switches to German and back, and remembers the choice', async () => {
    globalThis.fetch = stubApi({ providers: { enabled: true, providers: [GOOGLE] } }) as unknown as typeof fetch
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Deutsch' }))

    expect(await screen.findByText('Deine eigene Liste – privat für alle, die sich anmelden.')).toBeInTheDocument()
    expect(localStorage.getItem('taskfest.language')).toBe('de')
    expect(document.documentElement.lang).toBe('de')

    fireEvent.click(screen.getByRole('button', { name: 'English' }))

    expect(await screen.findByText('Your own list, private to whoever signs in.')).toBeInTheDocument()
    expect(localStorage.getItem('taskfest.language')).toBe('en')
  })
})
