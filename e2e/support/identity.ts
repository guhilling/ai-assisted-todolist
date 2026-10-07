/**
 * Who the signed-in scenarios sign in as, and how (#144).
 *
 * The same scenarios run against the Compose stack, with the local Keycloak accounts, and against
 * qa, with the Cognito test accounts (#190) -- `E2E_IDENTITY` picks which. Everything that differs
 * between the two lives here: the button to click, how to fill in the provider's login page, and
 * the two accounts. The scenarios themselves (tests/login.spec.ts) are not copied.
 */
import { type Page } from '@playwright/test'

/** One account the scenarios sign in with. */
export type Account = {
  username: string
  password: string
  email: string
  /** The display name the header shows: the provider's `name` claim. */
  name: string
  /** What the avatar shows when there is no picture, which for these addresses is always. */
  initials: string
}

/** A provider and its two accounts, the second only ever there to prove it cannot see the first's tasks. */
export type Identity = {
  id: 'keycloak' | 'cognito'
  /** The sign-in button's accessible name. */
  button: RegExp
  fillLoginForm(page: Page, account: Account): Promise<void>
  primary: Account
  secondary: Account
}

/** The realm both Dev Services and the Compose stack import (keycloak/realm-taskfest.json). */
const keycloak: Identity = {
  id: 'keycloak',
  button: /sign in with keycloak/i,
  async fillLoginForm(page, account) {
    await page.locator('#username').fill(account.username)
    await page.locator('#password').fill(account.password)
    await page.locator('#kc-login').click()
  },
  primary: { username: 'gunnar', password: 'gunnar', email: 'jboss.gunnar@hilling.de', name: 'Gunnar Hilling', initials: 'GH' },
  secondary: { username: 'lasse', password: 'lasse', email: 'lasse@example.com', name: 'Lasse Hilling', initials: 'LH' },
}

/** A password the live-test job set for this run, from the environment; never stored. */
function passwordFrom(variable: string) {
  const password = process.env[variable]
  if (!password) {
    throw new Error(`${variable} is not set: the live-test job sets the test accounts' passwords for each run.`)
  }
  return password
}

/**
 * qa's test accounts, signed in on Cognito's classic hosted login page. That page carries the same
 * form twice -- one for wide screens, one for narrow -- with the same ids, so only the visible one
 * is addressed.
 */
function cognito(): Identity {
  const account = (which: 'one' | 'two', variable: string): Account => ({
    username: `taskfest-test-${which}@example.com`,
    password: passwordFrom(variable),
    email: `taskfest-test-${which}@example.com`,
    name: `Test Account ${which === 'one' ? 'One' : 'Two'}`,
    initials: 'TA',
  })
  return {
    id: 'cognito',
    button: /sign in with taskfest test account/i,
    async fillLoginForm(page, signingIn) {
      await page.locator('input[name="username"]:visible').fill(signingIn.username)
      await page.locator('input[name="password"]:visible').fill(signingIn.password)
      await page.locator('input[name="signInSubmitButton"]:visible').click()
    },
    primary: account('one', 'E2E_PASSWORD_ONE'),
    secondary: account('two', 'E2E_PASSWORD_TWO'),
  }
}

/** The identity this run signs in with: Keycloak unless `E2E_IDENTITY=cognito`. */
export function currentIdentity(): Identity {
  return process.env.E2E_IDENTITY === 'cognito' ? cognito() : keycloak
}
