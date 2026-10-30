/**
 * The backend as the component tests see it: one stubbed `fetch` that answers every route the
 * board, the account dialog and the attachments reach, each as its options say.
 *
 * Five test files once carried a stub of their own, each answering the routes its tests reached;
 * this is their union. A route that is not configured answers as a working backend would, so a
 * test names only what it is about. The session is the exception: nobody is signed in until a
 * test says who, because the signed-out page is a state of its own. It answers by method as well
 * as by path, because list, create, update and delete all share the `/api/tasks` URL and only
 * the method tells them apart.
 */
import { vi, type Mock } from 'vitest'

/** A reply: its status, and its JSON body when it has one. */
export interface Answer {
  status: number
  body?: unknown
}

/** How a link to storage is answered: a status other than 200 refuses it; `url` is where a working one points. */
export interface LinkAnswer {
  status?: number
  url?: string
}

/** What an upload announces (#204): the file's name, type and size. */
export interface Announced {
  fileName: string
  contentType: string
  sizeBytes: number
}

/** The `fetch` stub, with the calls it has seen. */
export type ApiStub = Mock<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>

/** When every link the stub hands out expires. Nothing on the website reads it. */
const EXPIRES_AT = '2026-10-08T10:15:30Z'

/**
 * A 200 carrying `value`; a 401 for the sentinel `'error'`, which on a signed-in request now
 * means the session has gone; a 500 for `'server-error'`, a failure on the server's side.
 */
export function respond(value: unknown, status = 200) {
  if (value === 'error') {
    return Promise.resolve(new Response(null, { status: 401 }))
  }
  if (value === 'server-error') {
    return Promise.resolve(new Response(null, { status: 500 }))
  }
  if (value === null) {
    return Promise.resolve(new Response(null, { status }))
  }
  return Promise.resolve(new Response(JSON.stringify(value), { status }))
}

function answer({ status, body }: Answer) {
  return respond(body ?? null, status)
}

function linkTo(link: LinkAnswer | undefined, url: string) {
  if (link?.status !== undefined && link.status !== 200) {
    return respond(null, link.status)
  }
  return respond({ url: link?.url ?? url, expiresAt: EXPIRES_AT })
}

/** What `stubApi` answers with, route by route. */
export interface StubApiOptions {
  /** `/api/auth/me`: who is signed in. The default, `'error'`, is a 401: nobody. */
  me?: unknown
  /** `/api/auth/providers`. The default has sign-in enabled and no provider configured. */
  providers?: unknown
  /** What a GET of `/api/tasks` lists, or a sentinel `respond` knows. The default is an empty board. */
  tasks?: unknown
  /** A POST to `/api/tasks`: a fixed reply, or one made from what was sent. The default is a 201 with no body. */
  post?: Answer | ((sent: Record<string, unknown>) => Answer)
  /**
   * Answers every POST by echoing what was sent back with a fresh id, the way the server
   * does. Restoring several tasks at once needs this rather than a fixed list of replies,
   * because the order they are deleted in is the board's, not the test's.
   */
  echoPost?: boolean
  /** A PUT to a task. The default is a 200 with no body. */
  put?: Answer
  /** A DELETE of a task. The default is a 204. */
  del?: { status: number }
  /** A DELETE of `/api/account` (#213). The default is a 204. */
  deleteAccount?: { status: number }
  /**
   * A POST to `/api/tasks/{id}/attachments`, announcing an upload (#204): a fixed reply, or one
   * chosen by what was announced, `undefined` meaning the default. The default accepts the file
   * with an id of its own and a link to put it to, and remembers it for the confirmation.
   */
  announce?: Answer | ((announced: Announced) => Answer | undefined)
  /** The confirmation of an upload. The default is the attachment as it was announced, or a 200 with no body. */
  confirm?: Answer
  /** The status a DELETE of an attachment gets. The default is a 204. */
  remove?: number
  /** A link to a file. The default works and points at `https://bucket.example.com/object-<id>`. */
  link?: LinkAnswer
  /** A link to a thumbnail (#236). The default works and points at `https://bucket.example.com/thumbnail`. */
  thumbnailLink?: LinkAnswer
}

/** A `fetch` that answers as `options` say; see {@link StubApiOptions} for the defaults. */
export function stubApi(options: StubApiOptions = {}): ApiStub {
  let nextId = 90
  const announced = new Map<number, unknown>()
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const method = init?.method ?? 'GET'

    if (url.includes('/api/auth/me')) {
      return respond(options.me ?? 'error')
    }
    if (url.includes('/api/auth/providers')) {
      return respond(options.providers ?? { enabled: true, providers: [] })
    }
    if (url.endsWith('/api/account') && method === 'DELETE') {
      return respond(null, options.deleteAccount?.status ?? 204)
    }
    if (url.endsWith('/thumbnail-link')) {
      return linkTo(options.thumbnailLink, 'https://bucket.example.com/thumbnail')
    }
    const link = url.match(/\/attachments\/(\d+)\/link$/)
    if (link) {
      return linkTo(options.link, `https://bucket.example.com/object-${link[1]}`)
    }
    if (url.endsWith('/confirm')) {
      if (options.confirm) {
        return answer(options.confirm)
      }
      return respond(announced.get(Number(url.split('/').at(-2))) ?? null)
    }
    if (/\/attachments\/\d+$/.test(url) && method === 'DELETE') {
      return respond(null, options.remove ?? 204)
    }
    if (url.endsWith('/attachments') && method === 'POST') {
      const sent: Announced = JSON.parse(String(init?.body))
      const chosen = typeof options.announce === 'function' ? options.announce(sent) : options.announce
      if (chosen) {
        return answer(chosen)
      }
      const attachment = { id: sent.fileName.length, fileName: sent.fileName, contentType: sent.contentType, sizeBytes: sent.sizeBytes, thumbnail: false }
      announced.set(attachment.id, attachment)
      return respond({ attachment, url: `https://bucket.example.com/${sent.fileName}`, headers: {}, expiresAt: EXPIRES_AT }, 201)
    }
    if (url.includes('/api/tasks')) {
      if (method === 'POST') {
        if (options.echoPost) {
          nextId += 1
          return respond({ ...JSON.parse(String(init?.body)), id: nextId }, 201)
        }
        if (typeof options.post === 'function') {
          return answer(options.post(JSON.parse(String(init?.body))))
        }
        return respond(options.post?.body ?? null, options.post?.status ?? 201)
      }
      if (method === 'PUT') {
        return respond(options.put?.body ?? null, options.put?.status ?? 200)
      }
      if (method === 'DELETE') {
        return respond(null, options.del?.status ?? 204)
      }
      return respond(options.tasks ?? [])
    }
    return Promise.resolve(new Response(null, { status: 404 }))
  })
}

/**
 * What CloudFront answers every /api request with while an environment is down: its own 503,
 * with this text (spa-routing.js in the AWS module). The site itself is still served.
 */
const PAUSED = () => Promise.resolve(new Response('The backend is not running in this environment.\n', { status: 503 }))

/** A stub for a paused environment, naming itself through `/environment.json` when `name` is given. */
export function pausedEnvironment(name?: string) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/')) {
      return PAUSED()
    }
    if (url.endsWith('/environment.json') && name !== undefined) {
      return respond({ name })
    }
    return Promise.resolve(new Response(null, { status: 404 }))
  }) as unknown as typeof fetch
}
