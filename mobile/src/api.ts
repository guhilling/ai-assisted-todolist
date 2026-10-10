import { validateCurrentUserResponse, validateTaskResponse, type CurrentUser, type Task } from './web'

/**
 * The app's side of the REST API (#267): every request carries the ID token as a bearer token
 * (#266), and every response is checked against the schema the backend publishes, with the
 * website's own generated validators, before anything reads it.
 */

/** Where to ask, and as whom. */
export type Caller = { baseUrl: string; idToken: string }

/** The backend refused the token: expired, revoked or never valid. The app signs in again. */
export class SignedOutError extends Error {
  constructor() {
    super('The backend no longer accepts this sign-in.')
    this.name = 'SignedOutError'
  }
}

/** The backend answered with a failure other than a refused sign-in. */
export class RequestFailedError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`The backend answered ${status}.`)
    this.name = 'RequestFailedError'
    this.status = status
  }
}

/** The backend answered with something its own schema does not allow. */
export class ContractBreachError extends Error {
  constructor(what: string) {
    super(`The backend sent ${what} that does not match its schema.`)
    this.name = 'ContractBreachError'
  }
}

/** The signed-in user's tasks. */
export async function fetchTasks(caller: Caller, fetchImpl: typeof fetch = fetch): Promise<Task[]> {
  const data = await get(caller, '/api/tasks', fetchImpl)
  if (!Array.isArray(data)) {
    throw new ContractBreachError('a task list')
  }
  return data.map((item) => {
    if (!validateTaskResponse(item)) {
      throw new ContractBreachError('a task')
    }
    return item
  })
}

/** Who is signed in, as the backend sees it. */
export async function fetchCurrentUser(caller: Caller, fetchImpl: typeof fetch = fetch): Promise<CurrentUser> {
  const data = await get(caller, '/api/auth/me', fetchImpl)
  if (!validateCurrentUserResponse(data)) {
    throw new ContractBreachError('the signed-in user')
  }
  return data
}

async function get(caller: Caller, path: string, fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(`${caller.baseUrl}${path}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${caller.idToken}` },
  })
  if (response.status === 401) {
    throw new SignedOutError()
  }
  if (!response.ok) {
    throw new RequestFailedError(response.status)
  }
  return response.json()
}
