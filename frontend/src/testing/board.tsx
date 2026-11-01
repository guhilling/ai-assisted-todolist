/**
 * The board as the component tests address it: the fixtures it is rendered with, and the ways a
 * test reaches a row, its menu and the add row -- by what a user sees, never by markup.
 *
 * Dates are computed from the real today rather than hardcoded, because the board reads the
 * clock once on mount and groups rows by how far away they are. The arithmetic comes from
 * `dates.ts`, whose own tests pin it down directly.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect } from 'vitest'
import App from '../App'
import { addDays, todayIso } from '../dates'
import type { ApiStub } from './api'

export const TODAY = todayIso()

/** An ISO date `offset` days from today, for readable fixtures. */
export function isoIn(offset: number) {
  return addDays(TODAY, offset)
}

export const ALICE = { email: 'alice@example.com' }

export const GOOGLE = {
  id: 'google',
  label: 'Google',
  available: true,
  loginUrl: '/api/auth/login',
  issuer: 'https://accounts.google.com',
}

export const COGNITO = {
  id: 'cognito',
  label: 'TaskFest test account',
  available: true,
  loginUrl: '/api/auth/login/cognito',
  issuer: 'https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_pool',
}

/** A task due tomorrow, of medium importance, with whatever `overrides` say instead. */
export function task(overrides: Partial<{ id: number; description: string; dueDate: string; importance: string; state: string }>) {
  return {
    id: 1,
    description: 'A task',
    dueDate: isoIn(1),
    importance: 'MEDIUM',
    state: 'TODO',
    ...overrides,
  }
}

/** Waits for the signed-in board. The add row exists only once there is a session. */
export async function renderSignedIn(fetchMock: ApiStub) {
  globalThis.fetch = fetchMock as unknown as typeof fetch
  render(<App />)
  await waitFor(() => expect(screen.getByRole('button', { name: /add a task/i })).toBeInTheDocument())
}

/** The `<li>` for one task, so per-row controls can be addressed unambiguously. */
export function rowFor(description: string) {
  const checkbox = screen.getByLabelText(`Mark "${description}" as done`)
  const row = checkbox.closest('li')
  if (!row) {
    throw new Error(`No row found for "${description}"`)
  }
  return row
}

/** Opens a row's overflow menu, as a user must before its actions are reachable. */
export function openMenu(description: string) {
  // jsdom implements summary-toggles-details, so the click alone opens it.
  fireEvent.click(within(rowFor(description)).getByLabelText(`Actions for "${description}"`))
  return within(rowFor(description))
}

/** The JSON body of the first request the stub saw with `method`. */
export function bodyOf(fetchMock: ApiStub, method: string) {
  const call = fetchMock.mock.calls.find(([, init]) => init?.method === method)
  return JSON.parse(String(call?.[1]?.body))
}

/** Expands the add row and fills in a description. */
export function startAdding(description: string) {
  fireEvent.click(screen.getByRole('button', { name: /add a task/i }))
  fireEvent.change(screen.getByLabelText('What needs doing'), { target: { value: description } })
}
