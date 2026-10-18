import {
  importanceRank,
  needsDatingBack,
  restoreInput,
  storageUrl,
  validateAttachmentResponse,
  validateLinkResponse,
  validateRefusalResponse,
  validateTaskResponse,
  validateUploadResponse,
  validateVersionResponse,
  type Attachment,
  type RefusalResponse,
  type Task,
  type TaskInput,
  type TaskState,
} from './web'
import { REQUEST_MS, withinLimit } from './timeLimit'

export { REQUEST_MS, TimedOutError } from './timeLimit'

/**
 * The app's side of the REST API (#267): every request carries the ID token as a bearer token
 * (#266), and every response is checked against the schema the backend publishes, with the
 * website's own generated validators, before anything reads it.
 */

/** Where to ask, as whom, and from which release of the app, which goes along as `X-TaskFest-App`. */
export type Caller = { baseUrl: string; idToken: string; appVersion?: string }

/** The header the app names its release in, so the backend's log can tell who still calls what. */
const APP_VERSION_HEADER = 'X-TaskFest-App'

/** How long the start waits to hear which releases the backend serves, before carrying on. */
export const VERSION_CHECK_MS = 3000

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

/** Why a file was refused, as the backend names it -- or the phone, by the same rule. */
export type AttachmentRefusal = RefusalResponse['refusal']

/** A file refused, for the app to say why in the user's language. */
export class AttachmentRefusedError extends Error {
  readonly refusal: AttachmentRefusal

  constructor(refusal: AttachmentRefusal) {
    super(`The file was refused: ${refusal}.`)
    this.name = 'AttachmentRefusedError'
    this.refusal = refusal
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
  const data = await send(caller, 'GET', '/api/tasks', fetchImpl)
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
  const data = await send({ baseUrl, appVersion }, 'GET', '/api/version', fetchImpl, undefined, VERSION_CHECK_MS)
  if (!validateVersionResponse(data)) {
    throw new ContractBreachError('the running version')
  }
  return data.minimumAppVersion
}

/** Creates a task and hands it back as the backend stored it, with its new id. */
export async function createTask(caller: Caller, input: TaskInput, fetchImpl: typeof fetch = fetch): Promise<BoardTask> {
  return readTask(await send(caller, 'POST', '/api/tasks', fetchImpl, input))
}

/**
 * Saves a whole task: the backend replaces rather than patches, so the task goes back with the
 * fields that changed and the ones that did not. A past due date is accepted, as on the website.
 */
export async function updateTask(caller: Caller, task: Task, fetchImpl: typeof fetch = fetch): Promise<BoardTask> {
  const { description, dueDate, importance, state } = task
  return readTask(await send(caller, 'PUT', `/api/tasks/${task.id}`, fetchImpl, { description, dueDate, importance, state }))
}

/** Deletes a task. Its files stay detached on the backend for a while, for an undo. */
export async function deleteTask(caller: Caller, task: Task, fetchImpl: typeof fetch = fetch): Promise<void> {
  await send(caller, 'DELETE', `/api/tasks/${task.id}`, fetchImpl)
}

/**
 * Deletes the signed-in user's account with every task and file it holds (#275), as the website's
 * header does. It cannot be undone; forgetting the session is the caller's next step.
 */
export async function deleteAccount(caller: Caller, fetchImpl: typeof fetch = fetch): Promise<void> {
  await send(caller, 'DELETE', '/api/account', fetchImpl)
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

/**
 * A link that shows one of a task's files (#274), or its preview thumbnail, signed by the backend
 * for a limited time. It is handed back exactly as it came: a signed link must not be rewritten.
 *
 * It must pass the website's rule for links to storage (`storageUrl`): HTTPS, or plain HTTP to this
 * machine -- the end-to-end stack's storage. Anything else is a broken answer, not somewhere to send
 * the user.
 */
export async function attachmentLink(
  caller: Caller,
  taskId: Task['id'],
  attachmentId: Attachment['id'],
  thumbnail: boolean,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const which = thumbnail ? 'thumbnail-link' : 'link'
  const data = await send(caller, 'GET', `/api/tasks/${taskId}/attachments/${attachmentId}/${which}`, fetchImpl)
  const url = validateLinkResponse(data) ? storageUrl(data.url) : null
  if (!url) {
    throw new ContractBreachError('a link to a file')
  }
  return url
}

/** Where to upload a file announced, and its thumbnail, signed for the upload alone. */
export type Announcement = {
  attachment: Attachment
  url: string
  headers: Record<string, string>
  thumbnailUpload?: { url: string; headers: Record<string, string> }
}

/** What is announced of a file before it is uploaded. */
export type FileAnnouncement = { fileName: string; contentType: string; sizeBytes: number; thumbnailSizeBytes?: number }

/**
 * Announces a file for a task (#274), and hands back where to upload it -- and its thumbnail, when
 * one was announced -- with the headers the links were signed for. Both links must pass the
 * website's rule for links to storage.
 *
 * @throws AttachmentRefusedError when the backend refuses the file, saying why
 */
export async function announceAttachment(
  caller: Caller,
  taskId: Task['id'],
  file: FileAnnouncement,
  fetchImpl: typeof fetch = fetch,
): Promise<Announcement> {
  const data = await send(caller, 'POST', `/api/tasks/${taskId}/attachments`, fetchImpl, file)
  if (!validateUploadResponse(data)) {
    throw new ContractBreachError('an upload')
  }
  const url = storageUrl(data.url)
  const thumbnailUrl = data.thumbnailUpload ? storageUrl(data.thumbnailUpload.url) : undefined
  if (!url || thumbnailUrl === null) {
    throw new ContractBreachError('an upload')
  }
  return {
    attachment: data.attachment,
    url,
    headers: data.headers,
    ...(data.thumbnailUpload && thumbnailUrl ? { thumbnailUpload: { url: thumbnailUrl, headers: data.thumbnailUpload.headers } } : {}),
  }
}

/**
 * Says a file announced has been uploaded; the backend checks it arrived as announced and lists it
 * from then on.
 *
 * @throws AttachmentRefusedError when it did not arrive as announced (`MISMATCH`)
 */
export async function confirmAttachment(
  caller: Caller,
  taskId: Task['id'],
  attachmentId: Attachment['id'],
  fetchImpl: typeof fetch = fetch,
): Promise<Attachment> {
  const data = await send(caller, 'POST', `/api/tasks/${taskId}/attachments/${attachmentId}/confirm`, fetchImpl)
  if (!validateAttachmentResponse(data)) {
    throw new ContractBreachError('an attachment')
  }
  return data
}

/** Removes a file from its task, for good: unlike a task, a removed file has no undo. */
export async function removeAttachment(
  caller: Caller,
  taskId: Task['id'],
  attachmentId: Attachment['id'],
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await send(caller, 'DELETE', `/api/tasks/${taskId}/attachments/${attachmentId}`, fetchImpl)
}

/**
 * One request, signed in when there is an ID token, and the one place requests are made and their
 * failures read: the answer's body, none for a DELETE, within `ms` or a `TimedOutError`.
 */
async function send(
  caller: Omit<Caller, 'idToken'> & { idToken?: string },
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  fetchImpl: typeof fetch,
  body?: object,
  ms = REQUEST_MS,
): Promise<unknown> {
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
  return withinLimit(async (signal) => {
    const init: RequestInit =
      method === 'GET'
        ? { headers, signal }
        : body
          ? { method, headers, body: JSON.stringify(body), signal }
          : { method, headers, signal }
    const response = await fetchImpl(`${caller.baseUrl}${path}`, init)
    if (response.status === 401) {
      throw new SignedOutError()
    }
    if (response.status === 422) {
      // A file refused, with the backend's reason (#274).
      const refusal: unknown = await response.json().catch(() => null)
      if (validateRefusalResponse(refusal)) {
        throw new AttachmentRefusedError(refusal.refusal)
      }
    }
    if (!response.ok) {
      throw new RequestFailedError(response.status)
    }
    return method === 'DELETE' ? undefined : response.json()
  }, ms)
}
