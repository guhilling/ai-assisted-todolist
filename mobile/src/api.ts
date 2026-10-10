import {
  validateTaskResponse,
  validateVersionResponse,
  type Task,
  type TaskImportance,
  type TaskState,
} from './web'

/**
 * The app's side of the REST API (#267): every request carries the ID token as a bearer token
 * (#266), and every response is checked against the schema the backend publishes, with the
 * website's own generated validators, before anything reads it.
 */

/** Where to ask, as whom, and from which release of the app, which goes along as `X-TaskFest-App`. */
export type Caller = { baseUrl: string; idToken: string; appVersion?: string }

/** The header the app names its release in, so the backend's log can tell who still calls what. */
const APP_VERSION_HEADER = 'X-TaskFest-App'

/**
 * A task as the board holds it: as sent, except that an importance or state this release does not
 * know is listed in `unknown` and stands in as the least important, open value meanwhile (#268).
 */
export type BoardTask = Task & { unknown?: ('importance' | 'state')[] }

/** The values this release knows; a compile error here when the backend adds one. */
const KNOWN_IMPORTANCE: Record<TaskImportance, true> = { LOW: true, MEDIUM: true, HIGH: true }
const KNOWN_STATE: Record<TaskState, true> = { TODO: true, WORKING: true, DONE: true }

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
export async function fetchTasks(caller: Caller, fetchImpl: typeof fetch = fetch): Promise<BoardTask[]> {
  const data = await get(caller, '/api/tasks', fetchImpl)
  if (!Array.isArray(data)) {
    throw new ContractBreachError('a task list')
  }
  return data.map(readTask)
}

/**
 * One task, checked against the schema -- tolerating an importance or state a newer backend added.
 *
 * The website always deploys with its backend and stays strict. An installed app is older than its
 * backend, and a new enum value is a compatible change (doc/releasing.md), so the app reads one it
 * does not know as unknown instead of refusing the whole board. Anything else wrong still is.
 */
function readTask(item: unknown): BoardTask {
  if (validateTaskResponse(item)) {
    return item
  }
  if (typeof item === 'object' && item !== null) {
    const record = item as Record<string, unknown>
    const unknown: ('importance' | 'state')[] = []
    const stand = { ...record }
    if (typeof record.importance === 'string' && !(record.importance in KNOWN_IMPORTANCE)) {
      unknown.push('importance')
      stand.importance = 'LOW'
    }
    if (typeof record.state === 'string' && !(record.state in KNOWN_STATE)) {
      unknown.push('state')
      stand.state = 'TODO'
    }
    if (unknown.length > 0 && validateTaskResponse(stand)) {
      return { ...stand, unknown }
    }
  }
  throw new ContractBreachError('a task')
}

/**
 * The oldest app release the backend still serves, asked without a sign-in.
 *
 * @returns the version, such as `1.1.0`
 */
export async function fetchMinimumAppVersion(
  baseUrl: string,
  appVersion: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(`${baseUrl}/api/version`, {
    headers: { Accept: 'application/json', [APP_VERSION_HEADER]: appVersion },
  })
  if (!response.ok) {
    throw new RequestFailedError(response.status)
  }
  const data: unknown = await response.json()
  if (!validateVersionResponse(data)) {
    throw new ContractBreachError('the running version')
  }
  return data.minimumAppVersion
}

async function get(caller: Caller, path: string, fetchImpl: typeof fetch): Promise<unknown> {
  const headers: Record<string, string> = { Accept: 'application/json', Authorization: `Bearer ${caller.idToken}` }
  if (caller.appVersion) {
    headers[APP_VERSION_HEADER] = caller.appVersion
  }
  const response = await fetchImpl(`${caller.baseUrl}${path}`, { headers })
  if (response.status === 401) {
    throw new SignedOutError()
  }
  if (!response.ok) {
    throw new RequestFailedError(response.status)
  }
  return response.json()
}
