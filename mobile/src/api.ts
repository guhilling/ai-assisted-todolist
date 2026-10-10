import {
  importanceRank,
  needsDatingBack,
  restoreInput,
  validateTaskResponse,
  validateVersionResponse,
  type Task,
  type TaskInput,
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

/**
 * The states this release knows; a compile error here when the backend adds one. The importances
 * it knows are the website's `importanceRank`, which has every level for the same reason.
 */
const KNOWN_STATE: Record<TaskState, true> = { TODO: true, WORKING: true, DONE: true }

/** Whether a value is one of a record's own keys -- never a name every object inherits. */
function isKnown(value: unknown, known: object) {
  return typeof value === 'string' && Object.hasOwn(known, value)
}

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
    if (typeof record.importance === 'string' && !isKnown(record.importance, importanceRank)) {
      unknown.push('importance')
      stand.importance = 'LOW'
    }
    if (typeof record.state === 'string' && !isKnown(record.state, KNOWN_STATE)) {
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
  const data = await get({ baseUrl, appVersion }, '/api/version', fetchImpl)
  if (!validateVersionResponse(data)) {
    throw new ContractBreachError('the running version')
  }
  return data.minimumAppVersion
}

/** Creates a task and hands it back as the backend stored it, with its new id. */
export async function createTask(caller: Caller, input: TaskInput, fetchImpl: typeof fetch = fetch): Promise<BoardTask> {
  const response = await send(caller, 'POST', '/api/tasks', fetchImpl, input)
  return readTask(await response.json())
}

/**
 * Saves a whole task: the backend replaces rather than patches, so the task goes back with the
 * fields that changed and the ones that did not. A past due date is accepted, as on the website.
 */
export async function updateTask(caller: Caller, task: Task, fetchImpl: typeof fetch = fetch): Promise<BoardTask> {
  const { description, dueDate, importance, state } = task
  const response = await send(caller, 'PUT', `/api/tasks/${task.id}`, fetchImpl, { description, dueDate, importance, state })
  return readTask(await response.json())
}

/** Deletes a task. Its files stay detached on the backend for a while, for an undo. */
export async function deleteTask(caller: Caller, task: Task, fetchImpl: typeof fetch = fetch): Promise<void> {
  await send(caller, 'DELETE', `/api/tasks/${task.id}`, fetchImpl)
}

/**
 * Puts a deleted task back, with its files, by the website's own rule (`restoreInput`): a task
 * already overdue is created today and then dated back. It returns with a new id.
 */
export async function restoreTask(
  caller: Caller,
  task: Task,
  today: string,
  fetchImpl: typeof fetch = fetch,
): Promise<BoardTask> {
  const created = await createTask(caller, restoreInput(task, today), fetchImpl)
  return needsDatingBack(created, task) ? updateTask(caller, { ...created, dueDate: task.dueDate }, fetchImpl) : created
}

/** One GET, signed in when there is an ID token. */
async function get(
  caller: Omit<Caller, 'idToken'> & { idToken?: string },
  path: string,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  return (await send(caller, 'GET', path, fetchImpl)).json()
}

/** One request, and the one place requests are made and their failures read. */
async function send(
  caller: Omit<Caller, 'idToken'> & { idToken?: string },
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  fetchImpl: typeof fetch,
  body?: object,
): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (caller.idToken) {
    headers.Authorization = `Bearer ${caller.idToken}`
  }
  if (caller.appVersion) {
    headers[APP_VERSION_HEADER] = caller.appVersion
  }
  if (body) {
    headers['Content-Type'] = 'application/json'
  }
  const init: RequestInit =
    method === 'GET' ? { headers } : body ? { method, headers, body: JSON.stringify(body) } : { method, headers }
  const response = await fetchImpl(`${caller.baseUrl}${path}`, init)
  if (response.status === 401) {
    throw new SignedOutError()
  }
  if (!response.ok) {
    throw new RequestFailedError(response.status)
  }
  return response
}
