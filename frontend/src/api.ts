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
  AttachmentResponse,
  AuthProviderResponse,
  AuthProvidersResponse as WireAuthProvidersResponse,
  CurrentUserResponse,
  TaskCreateRequest,
  RefusalResponse,
  TaskResponse,
} from './generated/types'
import { makeThumbnail as makeImageThumbnail } from './thumbnail'
import {
  validateAttachmentResponse,
  validateAuthProvidersResponse,
  validateCurrentUserResponse,
  validateLinkResponse,
  validateRefusalResponse,
  validateTaskResponse,
  validateUploadResponse,
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

/**
 * A file on a task (#204): its name, type and size. The content is in storage, reached through a
 * link asked for when it is opened.
 */
export type Attachment = AttachmentResponse

/** Why an attachment was refused, as the backend names it; the board words it (#203). */
export type AttachmentRefusal = RefusalResponse['refusal']

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
    throw new RequestError('unaddressable')
  }
  // Past the guard the id is an integer and could be interpolated as it stands. The encoding is
  // kept because a path segment should be encoded on principle rather than because this
  // particular value happens to be safe. It is also what closed the traversal finding, where a
  // numeric guard alone did not -- Sonar's taint analysis recognises `encodeURIComponent` as a
  // sanitiser and does not recognise `Number.isSafeInteger` as a validator.
  return `${tasksBaseUrl}/${encodeURIComponent(id)}`
}

/**
 * What a failed request was doing, so the board can say it in the visitor's language (#203).
 *
 * This module speaks no visitor's language -- the wire layer stays language-free -- so it names a
 * failure by key and keeps an English message of its own, for consoles and tests. The board
 * words the key from its message catalogue (`i18n/failures.ts`).
 */
export type RequestErrorKey =
  | 'loadTasks'
  | 'createTask'
  | 'updateTask'
  | 'deleteTask'
  | 'unaddressable'
  | 'uploadAttachment'
  | 'openAttachment'
  | 'removeAttachment'
  | 'deleteAccount'

/** This module's own English, for a console or a test; the banner says the catalogue's text. */
const requestErrorMessages: Record<RequestErrorKey, string> = {
  loadTasks: 'Unable to load tasks from the backend.',
  createTask: 'Unable to create task.',
  updateTask: 'Unable to update task.',
  deleteTask: 'Unable to delete task.',
  unaddressable: 'That task could not be addressed.',
  uploadAttachment: 'Unable to upload the file.',
  openAttachment: 'Unable to open the file.',
  removeAttachment: 'Unable to remove the file.',
  deleteAccount: 'Unable to delete your account.',
}

/** A request that failed, named by what it was doing. */
export class RequestError extends Error {
  readonly key: RequestErrorKey

  constructor(key: RequestErrorKey) {
    super(requestErrorMessages[key])
    this.name = 'RequestError'
    this.key = key
  }
}

/** Which answer broke the contract. */
export type ContractSubject = 'task' | 'taskList' | 'signedInUser' | 'signInOptions' | 'attachment' | 'attachmentLink'

/** How it broke it, where checked by hand. */
export type ContractDetail = 'idNotInteger' | 'notArray'

const contractSubjects: Record<ContractSubject, string> = {
  task: 'a task',
  taskList: 'a task list',
  signedInUser: 'a signed-in user',
  signInOptions: 'the sign-in options',
  attachment: 'an attachment',
  attachmentLink: 'a link to a file',
}

const contractDetails: Record<ContractDetail, string> = {
  idNotInteger: 'its id is not an exact integer',
  notArray: 'it is not an array',
}

/**
 * The error a response that contradicts the published contract fails with.
 *
 * It names which answer broke the contract and, for the two things checked here by hand, how --
 * as keys, which the board words in the visitor's language. `detail` is omitted for a schema
 * failure: Ajv's `errors` would name the offending field, but reading it means a fallback for the
 * case where it is null, and Ajv never leaves it null after saying no. An unreachable branch is a
 * worse thing to carry than a shorter sentence, and devtools still has the response.
 */
export class ContractBreachError extends Error {
  readonly subject: ContractSubject
  readonly detail: ContractDetail | undefined

  constructor(subject: ContractSubject, detail?: ContractDetail) {
    const because = detail ? `: ${contractDetails[detail]}` : ''
    super(`The backend sent ${contractSubjects[subject]} that does not match its own API contract${because}.`)
    this.name = 'ContractBreachError'
    this.subject = subject
    this.detail = detail
  }
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
    throw new ContractBreachError('task')
  }
  const id = Number(data.id)
  if (!Number.isSafeInteger(id)) {
    throw new ContractBreachError('task', 'idNotInteger')
  }
  const task: Task = {
    id,
    description: data.description,
    dueDate: data.dueDate,
    importance: data.importance,
    state: data.state,
  }
  // Optional on the wire, so a backend from before attachments still validates; copied only when
  // sent, so a task looks exactly as it did then when it has none to speak of.
  if (data.attachments) {
    task.attachments = data.attachments.map((attachment) => toAttachment(attachment, 'task'))
  }
  return task
}

/** Turns a checked attachment into one the application owns, its id checked like a task's. */
function toAttachment(data: AttachmentResponse, subject: ContractSubject): Attachment {
  const id = Number(data.id)
  if (!Number.isSafeInteger(id)) {
    throw new ContractBreachError(subject, 'idNotInteger')
  }
  return { id, fileName: data.fileName, contentType: data.contentType, sizeBytes: data.sizeBytes, thumbnail: data.thumbnail }
}

/** Turns a checked response into the task list. Each task is checked in its own right. */
function toTasks(data: unknown): Task[] {
  if (!Array.isArray(data)) {
    throw new ContractBreachError('taskList', 'notArray')
  }
  return data.map(toTask)
}

/** Turns a checked response into the signed-in user, with absent and null collapsed into null. */
function toCurrentUser(data: unknown): CurrentUser {
  if (!validateCurrentUserResponse(data)) {
    throw new ContractBreachError('signedInUser')
  }
  return { email: data.email, name: data.name ?? null, pictureUrl: data.pictureUrl ?? null }
}

/** Turns a checked response into the sign-in options. */
function toAuthProviders(data: unknown): AuthProvidersResponse {
  if (!validateAuthProvidersResponse(data)) {
    throw new ContractBreachError('signInOptions')
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
async function readJson<T>(response: Response, parse: (data: unknown) => T, failure: RequestErrorKey) {
  ensureSession(response)
  if (!response.ok) {
    throw new RequestError(failure)
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
 * What CloudFront answers every /api request with while an environment is down: its own 503,
 * with exactly this text (spa-routing.js in the AWS module). The site is still served, so the
 * app can say so instead of offering a sign-in that cannot work.
 */
const pausedMessage = 'The backend is not running in this environment.'

/**
 * The environment's backend is switched off -- paused, not broken. Only CloudFront's own answer
 * counts: a load balancer with no healthy task answers 503 as well, and that is an outage.
 */
export class BackendPausedError extends Error {
  constructor() {
    super('This environment is paused.')
    this.name = 'BackendPausedError'
  }
}

/**
 * Loads the sign-in options. Returns null on failure so the app can still render its
 * signed-out view instead of breaking outright, and throws `BackendPausedError` while the
 * environment is down.
 */
export async function fetchAuthProviders() {
  const response = await fetch(authProvidersUrl)
  if (response.status === 503 && (await response.text()).trim() === pausedMessage) {
    throw new BackendPausedError()
  }
  return response.ok ? toAuthProviders(await response.json()) : null
}

/** Longer than any environment's name, short enough that a bad file cannot fill the page. */
const MAX_ENVIRONMENT_NAME_LENGTH = 40

/**
 * The deployment's own name for its environment, such as "QA", or null when it gives none.
 *
 * deploy-frontend.yml writes `/environment.json` into the site next to the release's build, so
 * one build serves every environment and still knows where it is. It belongs to the site, not
 * the API, so it is fetched from the page's own origin. Absent locally, and anything malformed
 * counts as absent: a name is a nicety on the paused page, never worth an error.
 */
export async function fetchEnvironmentName(): Promise<string | null> {
  try {
    const response = await fetch('/environment.json')
    if (!response.ok) {
      return null
    }
    const data: unknown = await response.json()
    const name = typeof data === 'object' && data !== null ? (data as { name?: unknown }).name : undefined
    return typeof name === 'string' && name.length > 0 && name.length <= MAX_ENVIRONMENT_NAME_LENGTH ? name : null
  } catch {
    return null
  }
}

/** Loads the signed-in user's tasks. Only ever their own -- the backend scopes the query. */
export async function fetchTasks() {
  const response = await fetch(tasksBaseUrl, { credentials: 'include', headers: jsFetchHeaders })
  return readJson(response, toTasks, 'loadTasks')
}

/** Creates a task and returns it as the backend stored it, including its generated id. */
export async function postTask(input: TaskInput) {
  const response = await fetch(tasksBaseUrl, {
    method: 'POST',
    credentials: 'include',
    headers: jsonHeaders,
    body: JSON.stringify(input),
  })
  return readJson(response, toTask, 'createTask')
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
  return readJson(response, toTask, 'updateTask')
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
    throw new RequestError('deleteTask')
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
  const input: TaskInput = {
    description: task.description,
    dueDate: task.dueDate < today ? today : task.dueDate,
    importance: task.importance,
    state: task.state,
  }
  // Its files were only detached by the delete, and come back with it within the undo window.
  if (task.attachments && task.attachments.length > 0) {
    input.attachmentIds = task.attachments.map((attachment) => attachment.id)
  }
  const created = await postTask(input)

  if (created.dueDate === task.dueDate) {
    return created
  }
  return putTask({ ...created, dueDate: task.dueDate })
}

/** The types the backend accepts (D2 on #204): PDFs, and the images every browser shows inline. */
export const attachmentTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']

/**
 * The limits the backend enforces (D1 on #204), here only to say them before an upload and to spare
 * one the backend would refuse anyway. The backend's configuration is the authority
 * (`taskfest.attachments.*`); should the two differ, its refusal is what the board shows.
 */
export const attachmentLimits = { maxSizeBytes: 10 * 1024 * 1024, perTask: 2, perUser: 5 }

/**
 * Why the backend would refuse this file, as far as the browser can tell without asking: its type,
 * or its size. Null when it may be sent. The add row checks with it the moment a file is chosen
 * (#216), and `uploadAttachment` before announcing one, so both refuse alike.
 */
export function checkFile(file: File): AttachmentRefusal | null {
  if (!attachmentTypes.includes(file.type)) {
    return 'UNSUPPORTED_TYPE'
  }
  if (file.size === 0) {
    return 'EMPTY'
  }
  return file.size > attachmentLimits.maxSizeBytes ? 'TOO_LARGE' : null
}

/** An attachment refused, for the board to say why in the visitor's language. */
export class AttachmentRefusedError extends Error {
  readonly refusal: AttachmentRefusal

  constructor(refusal: AttachmentRefusal) {
    super(`The file was refused: ${refusal}.`)
    this.name = 'AttachmentRefusedError'
    this.refusal = refusal
  }
}

/** The URL of a task's attachments, or of one of them, with every id checked like `taskUrl`. */
function attachmentsUrl(taskId: Task['id'], attachmentId?: Attachment['id']) {
  const base = `${taskUrl(taskId)}/attachments`
  if (attachmentId === undefined) {
    return base
  }
  if (!Number.isSafeInteger(attachmentId)) {
    throw new RequestError('unaddressable')
  }
  return `${base}/${encodeURIComponent(attachmentId)}`
}

/** Throws the backend's refusal when it gave one, as an {@link AttachmentRefusedError}. */
async function ensureNotRefused(response: Response) {
  if (response.status !== 422) {
    return
  }
  const data: unknown = await response.json().catch(() => null)
  if (validateRefusalResponse(data)) {
    throw new AttachmentRefusedError(data.refusal)
  }
}

/**
 * PUTs the file to the signed link, reporting progress as a fraction.
 *
 * `XMLHttpRequest` rather than `fetch`, because only it reports how much of an upload has gone.
 * The headers are the ones the link was signed for, sent exactly; the browser adds Content-Length
 * itself, and storage refuses a file of any other size.
 */
function putToStorage(url: string, headers: Record<string, string>, file: Blob, onProgress: (fraction: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('PUT', url)
    for (const [name, value] of Object.entries(headers)) {
      request.setRequestHeader(name, value)
    }
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(event.loaded / event.total)
      }
    }
    request.onload = () =>
      request.status >= 200 && request.status < 300 ? resolve() : reject(new RequestError('uploadAttachment'))
    request.onerror = () => reject(new RequestError('uploadAttachment'))
    request.send(file)
  })
}

/**
 * Attaches a file to a task: announces it, uploads it straight to storage through the link the
 * announcement returns, and confirms it. The content never passes through the backend.
 *
 * A file of a type or size the backend would refuse is refused here without a request, so a
 * 40 MB photo is not first uploaded to be told so.
 *
 * An image brings a preview thumbnail (#236), made here and uploaded next to it before the
 * confirmation, which is when the backend looks for it. It is optional: one that cannot be made,
 * or does not reach storage, leaves the attachment as it would have been without.
 *
 * @param makeThumbnail makes the thumbnail; a parameter so a test can do without a canvas
 * @throws AttachmentRefusedError when the file is refused, here or by the backend
 * @throws RequestError when a step fails for any other reason
 */
export async function uploadAttachment(
  taskId: Task['id'],
  file: File,
  onProgress: (fraction: number) => void,
  makeThumbnail: (file: File) => Promise<Blob | null> = makeImageThumbnail,
) {
  const refusal = checkFile(file)
  if (refusal) {
    throw new AttachmentRefusedError(refusal)
  }

  const thumbnail = file.type.startsWith('image/') ? await makeThumbnail(file) : null
  const announced = await fetch(attachmentsUrl(taskId), {
    method: 'POST',
    credentials: 'include',
    headers: jsonHeaders,
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type,
      sizeBytes: file.size,
      ...(thumbnail ? { thumbnailSizeBytes: thumbnail.size } : {}),
    }),
  })
  await ensureNotRefused(announced)
  const upload = await readJson(
    announced,
    (data) => {
      if (!validateUploadResponse(data)) {
        throw new ContractBreachError('attachment')
      }
      return {
        attachment: toAttachment(data.attachment, 'attachment'),
        url: data.url,
        headers: data.headers,
        thumbnailUpload: data.thumbnailUpload,
      }
    },
    'uploadAttachment',
  )

  await putToStorage(upload.url, upload.headers, file, onProgress)
  if (thumbnail && upload.thumbnailUpload) {
    // Without it the row shows the file itself, as it did before thumbnails.
    await putToStorage(upload.thumbnailUpload.url, upload.thumbnailUpload.headers, thumbnail, () => {}).catch(
      () => undefined,
    )
  }

  const confirmed = await fetch(`${attachmentsUrl(taskId, upload.attachment.id)}/confirm`, {
    method: 'POST',
    credentials: 'include',
    headers: jsFetchHeaders,
  })
  await ensureNotRefused(confirmed)
  return readJson(
    confirmed,
    (data) => {
      if (!validateAttachmentResponse(data)) {
        throw new ContractBreachError('attachment')
      }
      return toAttachment(data, 'attachment')
    },
    'uploadAttachment',
  )
}

/**
 * A link that opens the file, for the owner's browser only. The backend hands out the same link
 * while it is fresh, and says how long this answer may be kept, so the browser's own cache answers
 * a second ask and keeps the file by its URL (#236).
 */
export async function attachmentLink(taskId: Task['id'], attachmentId: Attachment['id']) {
  return linkTo(taskId, attachmentId, 'link')
}

/** A link to an image's preview thumbnail (#236), like {@link attachmentLink}. */
export async function thumbnailLink(taskId: Task['id'], attachmentId: Attachment['id']) {
  return linkTo(taskId, attachmentId, 'thumbnail-link')
}

async function linkTo(taskId: Task['id'], attachmentId: Attachment['id'], which: 'link' | 'thumbnail-link') {
  const response = await fetch(`${attachmentsUrl(taskId, attachmentId)}/${which}`, {
    credentials: 'include',
    headers: jsFetchHeaders,
  })
  return readJson(
    response,
    (data) => {
      if (!validateLinkResponse(data)) {
        throw new ContractBreachError('attachmentLink')
      }
      return data.url
    },
    'openAttachment',
  )
}

/** Removes a file from its task, for good: unlike a task, a removed file has no undo. */
export async function removeAttachment(taskId: Task['id'], attachmentId: Attachment['id']) {
  const response = await fetch(attachmentsUrl(taskId, attachmentId), {
    method: 'DELETE',
    credentials: 'include',
    headers: jsFetchHeaders,
  })
  ensureSession(response)
  if (!response.ok) {
    throw new RequestError('removeAttachment')
  }
}

const accountUrl = `${apiBaseUrl}/api/account`

/**
 * Deletes the signed-in user's account with every task and file it holds (#213). It cannot be
 * undone; signing out is the caller's next step.
 */
export async function deleteAccount() {
  const response = await fetch(accountUrl, { method: 'DELETE', credentials: 'include', headers: jsFetchHeaders })
  ensureSession(response)
  if (!response.ok) {
    throw new RequestError('deleteAccount')
  }
}
