/**
 * What the tests share: the clock they run on, a signed-in session, a board of three tasks, stores
 * in memory, and the app's {@link Dependencies} with every stand-in in place. A test file whose
 * defaults differ passes overrides, or keeps a constant of its own and says so; a helper one file
 * uses stays in that file. Not part of the app: `collectCoverageFrom` leaves it out.
 */
import { act } from '@testing-library/react-native'
import { AppState } from 'react-native'
import type { BoardTask } from './api'
import type { KeptBoard, KeptBoardStore } from './keptBoard'
import type { ReminderPermission, ReminderScheduler } from './notifications'
import type { Session } from './session'
import type { KeyValueStore, SessionStore } from './staySignedIn'
import type { Dependencies } from './TaskFestApp'
import { variantOf } from './variants'

/** 10 October 2026, 09:00 UTC: a Saturday, the day the tests run on. */
export const NOW = Date.UTC(2026, 9, 10, 9)
/** The day {@link NOW} falls on, as a due date. */
export const TODAY = '2026-10-10'
export const HOUR = 3600 * 1000
/** Where the `dev` variant reaches its backend. */
export const BASE = 'http://localhost:3000'

/** A token with the given payload; the header and signature do not matter to the app. */
export function tokenWith(payload: object) {
  const encoded = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `header.${encoded}.signature`
}

/** Ada's ID token, as a provider issues it. */
export const idToken = tokenWith({ exp: NOW / 1000 + 3600, email: 'ada@example.com' })
/** Ada, signed in at {@link NOW}. */
export const session: Session = { token: 'taskfest_app_ada', expiresAt: NOW + HOUR, email: 'ada@example.com' }

/** The board most tests start from: one task due today, one tomorrow, one done. */
export const water: BoardTask = { id: 1, description: 'Water the plants', dueDate: TODAY, importance: 'HIGH', state: 'TODO' }
export const train: BoardTask = { id: 2, description: 'Book the train', dueDate: '2026-10-11', importance: 'LOW', state: 'WORKING' }
export const rent: BoardTask = { id: 3, description: 'Pay the rent', dueDate: '2026-10-01', importance: 'MEDIUM', state: 'DONE' }
export const tasks: BoardTask[] = [water, train, rent]

/** A session store in memory, which also says what it holds. */
export function memorySessions(initial: Session | null): SessionStore & { current: () => Session | null } {
  let stored = initial
  return {
    current: () => stored,
    save: async (next) => void (stored = next),
    load: async () => stored,
    clear: async () => void (stored = null),
  }
}

/** A kept board in memory, which also says what it holds. */
export function memoryBoard(initial: KeptBoard | null): KeptBoardStore & { current: () => KeptBoard | null } {
  let stored = initial
  return {
    current: () => stored,
    load: async () => stored,
    save: jest.fn(async (board: KeptBoard) => void (stored = board)),
    clear: async () => void (stored = null),
  }
}

/** A keychain in memory, with its entries open to the test. */
export function memoryStore(): KeyValueStore & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => void values.set(key, value),
    deleteItemAsync: async (key) => void values.delete(key),
  }
}

/** Links as the backend signs them: one per file, another for its thumbnail. */
export function linkTo(_caller: unknown, taskId: number, attachmentId: number, thumbnail: boolean) {
  const which = thumbnail ? 'thumbnail' : 'file'
  return Promise.resolve(`https://bucket.example.com/${taskId}/${attachmentId}/${which}`)
}

/** Hands back what the app does when it comes back to the foreground. */
export function foreground() {
  let onChange: (state: string) => void = () => undefined
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    onChange = listener as (state: string) => void
    return { remove: jest.fn() } as never
  })
  return () => act(async () => onChange('active'))
}

/** Google's client IDs (#280), and the variants that sign in with them. */
export const GOOGLE = {
  TASKFEST_GOOGLE_WEB_CLIENT_ID: '1234-web.apps.googleusercontent.com',
  TASKFEST_QA_GOOGLE_IOS_CLIENT_ID: '1234-qa.apps.googleusercontent.com',
  TASKFEST_PROD_GOOGLE_IOS_CLIENT_ID: '1234-prod.apps.googleusercontent.com',
}
export const prod = variantOf('prod', GOOGLE)
export const qa = variantOf('qa', {
  ...GOOGLE,
  TASKFEST_QA_COGNITO_ISSUER: 'https://cognito-idp.eu-central-1.amazonaws.com/pool',
  TASKFEST_QA_APP_CLIENT_ID: 'app-client',
})

/**
 * The app's dependencies, every one a stand-in: Ada signed in, the three {@link tasks} on the
 * board, a backend that serves this release, nothing kept on the phone, the reminders refused.
 */
export function dependencies(overrides: Partial<Dependencies> = {}): Dependencies {
  return {
    sessions: memorySessions(session),
    provider: { signIn: jest.fn() },
    // A backend that trades every ID token, for a session whose token is the same: the tests tell whose it is by it.
    appSessions: { start: jest.fn(async (token: string) => ({ token, expiresAt: Date.UTC(2100, 0, 1) })), end: jest.fn().mockResolvedValue(undefined) },
    fetchTasks: jest.fn().mockResolvedValue(tasks),
    fetchMinimumAppVersion: jest.fn().mockResolvedValue('0.0.0'),
    changes: { create: jest.fn(), update: jest.fn(), remove: jest.fn(), restore: jest.fn() },
    deleteAccount: jest.fn().mockResolvedValue(undefined),
    keptBoard: { load: jest.fn().mockResolvedValue(null), save: jest.fn().mockResolvedValue(undefined), clear: jest.fn().mockResolvedValue(undefined) },
    reminders: { permission: jest.fn().mockResolvedValue('denied'), ask: jest.fn(), replace: jest.fn().mockResolvedValue(undefined), answered: jest.fn().mockResolvedValue(false), decline: jest.fn() },
    appVersion: '1.2.0',
    now: () => NOW,
    ...overrides,
  }
}

/**
 * What the reminders' tests share (#273, #665): a clock of their own, the phone's rather than UTC,
 * at 06:00 on 10 October 2026 -- before any 08:00 they look at; Ada signed in on it; a board to be
 * reminded of, two tasks due tomorrow and one overdue; a scheduler that says whether reminders are
 * allowed; and the app's dependencies with all of these, a backend that agrees to every change and
 * the reminders allowed.
 */
export const reminding = (() => {
  const NOW = new Date(2026, 9, 10, 6, 0).getTime()
  const session: Session = {
    token: tokenWith({ exp: NOW / 1000 + 3600, email: 'ada@example.com' }),
    expiresAt: NOW + HOUR,
    email: 'ada@example.com',
  }
  const water: BoardTask = { id: 1, description: 'Water the plants', dueDate: '2026-10-11', importance: 'HIGH', state: 'TODO' }
  const train: BoardTask = { id: 2, description: 'Book the train', dueDate: '2026-10-11', importance: 'LOW', state: 'TODO' }
  const rent: BoardTask = { id: 3, description: 'Pay the rent', dueDate: '2026-10-01', importance: 'MEDIUM', state: 'TODO' }

  /** Reminders with this permission; asked, they are allowed unless `allows` is false. */
  function scheduler(permission: ReminderPermission, { declined = false, allows = true } = {}) {
    let current = permission
    return {
      permission: jest.fn(async () => current),
      ask: jest.fn(async () => {
        current = allows ? 'granted' : 'denied'
        return allows
      }),
      replace: jest.fn().mockResolvedValue(undefined),
      answered: jest.fn().mockResolvedValue(declined),
      decline: jest.fn().mockResolvedValue(undefined),
    } satisfies ReminderScheduler
  }

  function remindingDependencies(overrides: Partial<Dependencies> = {}): Dependencies {
    return dependencies({
      sessions: memorySessions(session),
      fetchTasks: jest.fn().mockResolvedValue([water, train, rent]),
      changes: { create: jest.fn(), update: jest.fn(async (_caller, task) => task), remove: jest.fn(), restore: jest.fn() },
      reminders: scheduler('granted'),
      now: () => NOW,
      ...overrides,
    })
  }

  return { NOW, session, water, train, rent, scheduler, dependencies: remindingDependencies }
})()
