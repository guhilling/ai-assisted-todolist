/**
 * The wire: the types the backend speaks and the functions that call it.
 *
 * Split out of `App.tsx` so the components hold state and rendering only. The module's own
 * header comment there named this as the seam to cut on first, and the board's redesign is
 * what made it worth cutting.
 */

/**
 * Where a task stands in the workflow. Mirrors the backend's TaskState enum; the two must be
 * changed together, since these strings go over the wire verbatim.
 */
export type TaskState = 'TODO' | 'WORKING' | 'DONE'

/** How much a task matters. Mirrors the backend's TaskImportance enum. */
export type TaskImportance = 'LOW' | 'MEDIUM' | 'HIGH'

/** A task as the backend returns it, matching TaskResource.TaskResponse. */
export type Task = {
  id: number
  description: string
  dueDate: string
  importance: TaskImportance
  state: TaskState
}

/** The fields a client may set, matching TaskResource.TaskCreateRequest. */
export type TaskInput = {
  description: string
  dueDate: string
  importance: TaskImportance
  state: TaskState
}

/**
 * One sign-in option offered by the backend.
 *
 * The frontend hardcodes no provider names: whatever the backend lists is what the user
 * sees. `available` is false and `loginUrl` null when a provider is configured but has no
 * credentials — the board treats those as absent rather than showing a dead button.
 */
export type AuthProvider = {
  id: string
  label: string
  available: boolean
  loginUrl: string | null
  issuer: string
}

/**
 * The reply from `/api/auth/providers`. `enabled` says whether authentication is switched on
 * for this deployment at all, which is a different thing from every provider happening to be
 * unconfigured.
 */
export type AuthProvidersResponse = {
  enabled: boolean
  providers: AuthProvider[]
}

/** Who is signed in. The backend exposes only the email claim, which is the whole identity. */
export type CurrentUser = {
  email: string
}

/**
 * Where the API lives. Empty by default, so requests go same-origin and are proxied -- by
 * Vite in development, by nginx in a container. Set VITE_API_BASE_URL only to point the app
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

/** Unwraps a thrown value into something displayable, since a `catch` binding is `unknown`. */
export function toErrorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback
}

/**
 * Parses a successful JSON response, turning any non-2xx status into an error carrying a
 * message the user can actually read.
 */
async function readJson<T>(response: Response, failureMessage: string) {
  if (!response.ok) {
    throw new Error(failureMessage)
  }
  return (await response.json()) as T
}

/**
 * Asks who is signed in, returning null rather than throwing when nobody is.
 *
 * Being signed out is the normal first-visit state, not a failure, so a 401 here is expected
 * and must not surface as an error banner.
 */
export async function fetchCurrentUser() {
  const response = await fetch(authMeUrl, { credentials: 'include', headers: jsFetchHeaders })
  return response.ok ? ((await response.json()) as CurrentUser) : null
}

/**
 * Loads the sign-in options. Returns null on failure so the app can still render its
 * signed-out view instead of breaking outright.
 */
export async function fetchAuthProviders() {
  const response = await fetch(authProvidersUrl)
  return response.ok ? ((await response.json()) as AuthProvidersResponse) : null
}

/** Loads the signed-in user's tasks. Only ever their own -- the backend scopes the query. */
export async function fetchTasks() {
  const response = await fetch(tasksBaseUrl, { credentials: 'include', headers: jsFetchHeaders })
  return readJson<Task[]>(response, 'Unable to load tasks from the backend.')
}

/** Creates a task and returns it as the backend stored it, including its generated id. */
export async function postTask(input: TaskInput) {
  const response = await fetch(tasksBaseUrl, {
    method: 'POST',
    credentials: 'include',
    headers: jsonHeaders,
    body: JSON.stringify(input),
  })
  return readJson<Task>(response, 'Unable to create task.')
}

/**
 * Saves a whole task.
 *
 * The backend's update endpoint replaces rather than patches, so callers send the task back
 * with the one field they changed. A past due date is accepted here -- deliberately, because
 * the common edit is completing something that is already late.
 */
export async function putTask(task: Task) {
  const response = await fetch(`${tasksBaseUrl}/${task.id}`, {
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
  return readJson<Task>(response, 'Unable to update task.')
}

/** Removes a task for good. The backend answers 204, so there is nothing to parse. */
export async function deleteTask(task: Task) {
  const response = await fetch(`${tasksBaseUrl}/${task.id}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: jsFetchHeaders,
  })
  if (!response.ok) {
    throw new Error('Unable to delete task.')
  }
}
