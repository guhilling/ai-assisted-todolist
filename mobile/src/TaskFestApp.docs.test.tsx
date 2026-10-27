import { render, screen, userEvent } from '@testing-library/react-native'
import { Linking } from 'react-native'
import type { BoardTask } from './api'
import type { Session } from './session'
import type { SessionStore } from './staySignedIn'
import { TaskFestApp, type Dependencies } from './TaskFestApp'
import { variants } from './variants'
import type { Language } from './web'

// The link to the documentation, at the top of the app (#384): the page the website's footer links
// as "About", signed in and signed out.

const NOW = Date.UTC(2026, 9, 10, 9)
const HOUR = 3600 * 1000
const PURPOSE = 'https://taskfest-docs.cloud.hilling.de/doc/purpose.html'

function tokenWith(payload: object) {
  const encoded = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `header.${encoded}.signature`
}

const session: Session = {
  idToken: tokenWith({ exp: NOW / 1000 + 3600, email: 'ada@example.com' }),
  refreshToken: 'r',
  expiresAt: NOW + HOUR,
  lastUsedAt: NOW,
}
const water: BoardTask = { id: 1, description: 'Water the plants', dueDate: '2026-10-10', importance: 'HIGH', state: 'TODO' }

function sessions(initial: Session | null): SessionStore {
  let current = initial
  return {
    load: async () => current,
    save: async (next) => {
      current = next
    },
    clear: async () => {
      current = null
    },
  }
}

function dependencies(signedIn: boolean): Dependencies {
  return {
    sessions: sessions(signedIn ? session : null),
    provider: { signIn: jest.fn(), refresh: jest.fn() },
    fetchTasks: jest.fn().mockResolvedValue([water]),
    fetchMinimumAppVersion: jest.fn().mockResolvedValue('0.0.0'),
    changes: { create: jest.fn(), update: jest.fn(), remove: jest.fn(), restore: jest.fn() },
    deleteAccount: jest.fn(),
    keptBoard: { load: jest.fn().mockResolvedValue(null), save: jest.fn().mockResolvedValue(undefined), clear: jest.fn().mockResolvedValue(undefined) },
    reminders: { permission: jest.fn().mockResolvedValue('denied'), ask: jest.fn(), replace: jest.fn().mockResolvedValue(undefined), answered: jest.fn().mockResolvedValue(false), decline: jest.fn() },
    appVersion: '1.2.0',
    now: () => NOW,
  }
}

async function start(signedIn: boolean, language: Language = 'en') {
  await render(<TaskFestApp variant={variants.dev} language={language} dependencies={dependencies(signedIn)} />)
  await screen.findByText(signedIn ? 'Water the plants' : 'Sign in with Keycloak')
}

// jest-expo's Linking is a mock already, which outlives each test's calls unless they are cleared.
beforeEach(() => {
  jest.spyOn(Linking, 'openURL').mockClear().mockResolvedValue(true)
})

describe('the link to the documentation (#384)', () => {
  it('opens the documentation from the top of the board', async () => {
    await start(true)

    await userEvent.setup().press(screen.getByRole('link', { name: 'About ↗' }))

    expect(Linking.openURL).toHaveBeenCalledWith(PURPOSE)
  })

  it('opens it before signing in, too', async () => {
    await start(false)

    await userEvent.setup().press(screen.getByRole('link', { name: 'About ↗' }))

    expect(Linking.openURL).toHaveBeenCalledWith(PURPOSE)
  })

  it('says so in German', async () => {
    await start(true, 'de')

    expect(screen.getByRole('link', { name: 'Über das Projekt ↗' })).toBeOnTheScreen()
  })
})
