/**
 * The wire: the types the backend speaks and the functions that call it.
 *
 * Split out of `App.tsx` so the components hold state and rendering only. The module's own
 * header comment there named this as the seam to cut on first, and the board's redesign is
 * what made it worth cutting.
 *
 * Nothing here declares what the backend returns. The types and the validators both come from
 * the JSON Schemas the backend publishes — `doc/api/schema/`, turned into `src/generated/` by
 * `npm run generate:api` — so this module's remaining job is to call, to check what came back,
 * and to turn a checked response into a value the application owns.
 */
import type {
  AuthProviderResponse,
  AuthProvidersResponse as WireAuthProvidersResponse,
  CurrentUserResponse,
  TaskCreateRequest,
  TaskResponse,
} from './generated/types'
import {
  validateAuthProvidersResponse,
  validateCurrentUserResponse,
  validateTaskResponse,
} from './generated/validators'

/**
 * Where a task stands in the workflow, and how much it matters.
 *
 * Both are the backend's enums, and the strings travel over the wire verbatim. They used to be
 * declared here with a comment saying the two definitions had to be changed together — a
 * convention that depended on being remembered. Now they are generated from the backend's
 * schema, so they cannot come apart.
 */
export type { TaskImportance, TaskState } from './generated/types'

/**
 * A task as the backend returns it.
 *
 * An alias rather than a declaration of its own: the shape belongs to the backend, and
 * `doc/api/schema/TaskResponse.schema.json` is where it is written down. The alias is here so
 * the rest of the application can go on saying `Task`, which is the domain's word for it.
 */
export type Task = TaskResponse

/** The fields a client may set. The backend's create request, generated from its schema. */
export type TaskInput = TaskCreateRequest

/**
 * One sign-in option offered by the backend.
 *
 * The frontend hardcodes no provider names: whatever the backend lists is what the user
 * sees. `available` is false and `loginUrl` null when a provider is configured but has no
 * credentials — the board treats those as absent rather than showing a dead button.
 */
export type AuthProvider = AuthProviderResponse

/**
 * The reply from `/api/auth/providers`. `enabled` says whether authentication is switched on
 * for this deployment at all, which is a different thing from every provider happening to be
 * unconfigured.
 */
export type AuthProvidersResponse = WireAuthProvidersResponse

/**
 * Who is signed in.
 *
 * The email is the identity — it is what the backend keys a user by and decides ownership on.
 * `name` and `pictureUrl` are neither stored nor identifying: the backend reads them from the
 * provider's token on each request, so they exist only for as long as the session does, and
 * either may be absent because a provider need not supply it. `toCurrentUser` turns absent into
 * null, so a caller has one case to handle rather than two.
 */
export type CurrentUser = CurrentUserResponse

/**
 * Where the API lives. Empty by default, so requests go same-origin and are proxied -- by
 * Vite in development, by httpd in a container. Set VITE_API_BASE_URL only to point the app
 * at a backend on a different origin.
 */
export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? ''
export const authLogoutUrl = `${apiBaseUrl}/api/auth/logout`

const authProvidersUrl = `${apiBaseUrl}/api/auth/providers`
const authMeUrl = `${apiBaseUrl}/api/auth/me`
const tasksBaseUrl = `${apiBaseUrl}/api/tasks`

/**
 * Marks a request as coming from script rather than from browser navigation.
 *
 * The backend sets `quarkus.oidc.authentication.java-script-auto-redirect=false`, so a
 * request carrying this header gets a plain 401 instead of a redirect to the identity
 * provider -- which is what lets `fetchCurrentUser` probe the session without navigating the
 * page away.
 */
const jsFetchHeaders = { 'X-Requested-With': 'JavaScript' }

const jsonHeaders = { ...jsFetchHeaders, 'Content-Type': 'application/json' }

/**
 * The URL that addresses one task.
 *
 * Every task that came from the backend has already had its id checked against the published
 * schema by `toTask`. This guard is for the ones that did not: `putTask` and `deleteTask` take
 * a `Task` from a caller, and a caller can build one. It stays because a URL built from an
 * unchecked id is what SonarCloud reported as API traversal and client-side request forgery,
 * and being right twice costs three lines.
 *
 * It throws rather than coercing: a task whose id is not a task id is a broken response, and
 * quietly addressing a different one would be worse than failing.
 */
function taskUrl(id: Task['id']) {
  if (!Number.isSafeInteger(id)) {
    throw new Error('That task could not be addressed.')
  }
  // Past the guard the id is an integer and could be interpolated as it stands. The encoding is
  // kept because a path segment should be encoded on principle rather than because this
  // particular value happens to be safe. It is also what closed the traversal finding, where a
  // numeric guard alone did not -- Sonar's taint analysis recognises `encodeURIComponent` as a
  // sanitiser and does not recognise `Number.isSafeInteger` as a validator.
  return `${tasksBaseUrl}/${encodeURIComponent(id)}`
}

/** Unwraps a thrown value into something displayable, since a `catch` binding is `unknown`. */
export function toErrorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback
}

/**
 * The error a response that contradicts the published contract fails with.
 *
 * It reaches the board's error banner through `toErrorMessage`, so it is written to be read by
 * a person. `detail` is given for the two things checked here by hand and omitted for a schema
 * failure: Ajv's `errors` would name the offending field, but reading it means a fallback for
 * the case where it is null, and Ajv never leaves it null after saying no. An unreachable
 * branch is a worse thing to carry than a shorter sentence, and devtools still has the
 * response.
 */
function contractBreach(what: string, detail?: string) {
  const because = detail ? `: ${detail}` : ''
  return new Error(`The backend sent ${what} that does not match its own API contract${because}.`)
}

/**
 * Turns a checked response into a task.
 *
 * The fields are copied into a new object rather than the validated one being handed back. That
 * is the difference that matters: past this point `id` is a number because a check said so and
 * `Number` produced it, not because `as` claimed it. The safe-integer test is here rather than
 * only in `taskUrl` because the schema cannot express it — `format: int64` describes a range
 * JavaScript has no exact numbers for — and a response is the right place to reject a response.
 */
function toTask(data: unknown): Task {
  if (!validateTaskResponse(data)) {
    throw contractBreach('a task')
  }
  const id = Number(data.id)
  if (!Number.isSafeInteger(id)) {
    throw contractBreach('a task', 'its id is not an exact integer')
  }
  return {
    id,
    description: data.description,
    dueDate: data.dueDate,
    importance: data.importance,
    state: data.state,
  }
}

/** Turns a checked response into the task list. Each task is checked in its own right. */
function toTasks(data: unknown): Task[] {
  if (!Array.isArray(data)) {
    throw contractBreach('a task list', 'it is not an array')
  }
  return data.map(toTask)
}

/** Turns a checked response into the signed-in user, with absent and null collapsed into null. */
function toCurrentUser(data: unknown): CurrentUser {
  if (!validateCurrentUserResponse(data)) {
    throw contractBreach('a signed-in user')
  }
  return { email: data.email, name: data.name ?? null, pictureUrl: data.pictureUrl ?? null }
}

/** Turns a checked response into the sign-in options. */
function toAuthProviders(data: unknown): AuthProvidersResponse {
  if (!validateAuthProvidersResponse(data)) {
    throw contractBreach('the sign-in options')
  }
  return {
    enabled: data.enabled,
    providers: data.providers.map((provider) => ({
      id: provider.id,
      label: provider.label,
      available: provider.available,
      loginUrl: provider.loginUrl,
      issuer: provider.issuer,
    })),
  }
}

/**
 * The session ended while the app was open: the request came back 401, or 499 -- what Quarkus
 * answers a script that asked not to be redirected to the identity provider.
 *
 * Its own type rather than an error message, because it is not a failure of the request that
 * noticed it. Every later request would fail the same way; what the reader needs is to sign in
 * again, and the app shows exactly that instead of an error about one particular change.
 */
export class SessionExpiredError extends Error {
  constructor() {
    super('Your session has expired.')
    this.name = 'SessionExpiredError'
  }
}

/** The statuses that mean "no session any more" on a request that had one. */
const SESSION_GONE = new Set([401, 499])

/** Throws {@link SessionExpiredError} if the response says the session is gone. */
function ensureSession(response: Response) {
  if (SESSION_GONE.has(response.status)) {
    throw new SessionExpiredError()
  }
}

/**
 * Reads a successful response, turning any non-2xx status into an error carrying a message the
 * user can actually read, and anything that is not what the contract promised into another. A
 * response saying the session is gone becomes a {@link SessionExpiredError} instead.
 *
 * The parser is passed in rather than the type being asserted. `as T` used to stand here, which
 * TypeScript erases: every field of every response was the right type by claim only. See
 * `doc/decisions/frontend.md`.
 */
async function readJson<T>(response: Response, parse: (data: unknown) => T, failureMessage: string) {
  ensureSession(response)
  if (!response.ok) {
    throw new Error(failureMessage)
  }
  return parse(await response.json())
}

/**
 * Asks who is signed in, returning null rather than throwing when nobody is.
 *
 * Being signed out is the normal first-visit state, not a failure, so a 401 here is expected
 * and must not surface as an error banner.
 */
export async function fetchCurrentUser() {
  const response = await fetch(authMeUrl, { credentials: 'include', headers: jsFetchHeaders })
  return response.ok ? toCurrentUser(await response.json()) : null
}

/**
 * Loads the sign-in options. Returns null on failure so the app can still render its
 * signed-out view instead of breaking outright.
 */
export async function fetchAuthProviders() {
  const response = await fetch(authProvidersUrl)
  return response.ok ? toAuthProviders(await response.json()) : null
}

/** Loads the signed-in user's tasks. Only ever their own -- the backend scopes the query. */
export async function fetchTasks() {
  const response = await fetch(tasksBaseUrl, { credentials: 'include', headers: jsFetchHeaders })
  return readJson(response, toTasks, 'Unable to load tasks from the backend.')
}

/** Creates a task and returns it as the backend stored it, including its generated id. */
export async function postTask(input: TaskInput) {
  const response = await fetch(tasksBaseUrl, {
    method: 'POST',
    credentials: 'include',
    headers: jsonHeaders,
    body: JSON.stringify(input),
  })
  return readJson(response, toTask, 'Unable to create task.')
}

/**
 * Saves a whole task.
 *
 * The backend's update endpoint replaces rather than patches, so callers send the task back
 * with the one field they changed. A past due date is accepted here -- deliberately, because
 * the common edit is completing something that is already late.
 */
export async function putTask(task: Task) {
  const response = await fetch(taskUrl(task.id), {
    method: 'PUT',
    credentials: 'include',
    headers: jsonHeaders,
    body: JSON.stringify({
      description: task.description,
      dueDate: task.dueDate,
      importance: task.importance,
      state: task.state,
    }),
  })
  return readJson(response, toTask, 'Unable to update task.')
}

/** Removes a task for good. The backend answers 204, so there is nothing to parse. */
export async function deleteTask(task: Task) {
  const response = await fetch(taskUrl(task.id), {
    method: 'DELETE',
    credentials: 'include',
    headers: jsFetchHeaders,
  })
  ensureSession(response)
  if (!response.ok) {
    throw new Error('Unable to delete task.')
  }
}

/**
 * Puts a deleted task back.
 *
 * Two requests rather than one, because creating refuses a date in the past: a task that was
 * already overdue when it was deleted is created dated today and then corrected by an update,
 * which does allow one. Without that, undo would fail for exactly the tasks people delete
 * most -- the old ones.
 *
 * It comes back with a **new id**. The server has no memory of the old one, and nothing here
 * refers to a task by id except the rows themselves, so the only visible effect is where it
 * lands among tasks sharing its due date.
 */
export async function restoreTask(task: Task, today: string) {
  const created = await postTask({
    description: task.description,
    dueDate: task.dueDate < today ? today : task.dueDate,
    importance: task.importance,
    state: task.state,
  })

  if (created.dueDate === task.dueDate) {
    return created
  }
  return putTask({ ...created, dueDate: task.dueDate })
}
