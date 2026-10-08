/**
 * The wire for attachments (#204): announcing, uploading straight to storage, confirming, and
 * asking for a link to open one -- against a stubbed `fetch` and a stubbed `XMLHttpRequest`, the
 * second because only it reports upload progress.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AttachmentRefusedError,
  ContractBreachError,
  attachmentLink,
  fetchTasks,
  thumbnailLink,
  removeAttachment,
  RequestError,
  restoreTask,
  uploadAttachment,
  type Task,
} from './api'

const PDF_ATTACHMENT = { id: 7, fileName: 'Rechnung.pdf', contentType: 'application/pdf', sizeBytes: 12, thumbnail: false }

const UPLOAD = {
  attachment: PDF_ATTACHMENT,
  url: 'https://bucket.example.com/key?X-Amz-Signature=abc',
  headers: { 'Content-Type': 'application/pdf' },
  expiresAt: '2026-10-08T10:15:30.123456Z',
}

type Call = { url: string; method: string; body: unknown }

/** Answers each request from a list of [method, path fragment, status, body], recording it. */
function backend(answers: [string, string, number, unknown][]) {
  const calls: Call[] = []
  globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const answer = answers.find(([m, path]) => m === method && url.includes(path))
    if (!answer) {
      return Promise.resolve(new Response(null, { status: 404 }))
    }
    const [, , status, body] = answer
    return Promise.resolve(new Response(body === null ? null : JSON.stringify(body), { status }))
  }) as unknown as typeof fetch
  return calls
}

/** What the fake XMLHttpRequest saw, and how it answers. */
const storage = { status: 200, sent: [] as { method: string; url: string; headers: Record<string, string>; body: unknown }[] }

class FakeXhr {
  /** Whether the upload's size is known, which a browser does not always report. */
  static computable = true
  status = 0
  upload = { onprogress: null as ((event: { loaded: number; total: number; lengthComputable: boolean }) => void) | null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  private method = ''
  private url = ''
  private headers: Record<string, string> = {}

  open(method: string, url: string) {
    this.method = method
    this.url = url
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value
  }

  send(body: unknown) {
    storage.sent.push({ method: this.method, url: this.url, headers: this.headers, body })
    this.upload.onprogress?.({ loaded: 6, total: 12, lengthComputable: FakeXhr.computable })
    this.status = storage.status
    if (storage.status === 0) {
      this.onerror?.()
    } else {
      this.onload?.()
    }
  }
}

function file(name: string, type: string, size = 12) {
  return new File(['x'.repeat(size)], name, { type })
}

afterEach(() => {
  vi.restoreAllMocks()
  FakeXhr.computable = true
  storage.status = 200
  storage.sent = []
})

describe('uploading an attachment', () => {
  it('announces the file, PUTs it to the signed link with its headers, and confirms it', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
    const calls = backend([
      ['POST', '/api/tasks/3/attachments/7/confirm', 200, PDF_ATTACHMENT],
      ['POST', '/api/tasks/3/attachments', 201, UPLOAD],
    ])
    const progress: number[] = []
    const pdf = file('Rechnung.pdf', 'application/pdf')

    await expect(uploadAttachment(3, pdf, (fraction) => progress.push(fraction))).resolves.toEqual(PDF_ATTACHMENT)

    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: '/api/tasks/3/attachments',
      body: { fileName: 'Rechnung.pdf', contentType: 'application/pdf', sizeBytes: 12 },
    })
    expect(storage.sent).toEqual([{ method: 'PUT', url: UPLOAD.url, headers: UPLOAD.headers, body: pdf }])
    expect(progress).toEqual([0.5])
    expect(calls[1]).toMatchObject({ method: 'POST', url: '/api/tasks/3/attachments/7/confirm' })
  })

  it('refuses a type or a size the backend would refuse, without asking it', async () => {
    const calls = backend([])

    await expect(uploadAttachment(3, file('page.html', 'text/html'), () => {})).rejects.toEqual(
      new AttachmentRefusedError('UNSUPPORTED_TYPE'),
    )
    await expect(uploadAttachment(3, file('big.pdf', 'application/pdf', 10 * 1024 * 1024 + 1), () => {})).rejects.toEqual(
      new AttachmentRefusedError('TOO_LARGE'),
    )
    await expect(uploadAttachment(3, file('empty.pdf', 'application/pdf', 0), () => {})).rejects.toEqual(
      new AttachmentRefusedError('EMPTY'),
    )
    expect(calls).toEqual([])
  })

  it('passes on why the backend refused', async () => {
    backend([['POST', '/api/tasks/3/attachments', 422, { refusal: 'TASK_FULL' }]])

    const failure = await uploadAttachment(3, file('third.png', 'image/png'), () => {}).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(AttachmentRefusedError)
    expect((failure as AttachmentRefusedError).refusal).toBe('TASK_FULL')
  })

  it('fails as an upload when storage refuses the file, and does not confirm it', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
    storage.status = 403
    const calls = backend([['POST', '/api/tasks/3/attachments', 201, UPLOAD]])

    await expect(uploadAttachment(3, file('Rechnung.pdf', 'application/pdf'), () => {})).rejects.toEqual(
      new RequestError('uploadAttachment'),
    )
    expect(calls.map((call) => call.url)).toEqual(['/api/tasks/3/attachments'])
  })

  it('fails as an upload when the network drops it', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
    storage.status = 0
    backend([['POST', '/api/tasks/3/attachments', 201, UPLOAD]])

    await expect(uploadAttachment(3, file('Rechnung.pdf', 'application/pdf'), () => {})).rejects.toEqual(
      new RequestError('uploadAttachment'),
    )
  })

  it('passes on a confirm that found the file not as announced', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
    backend([
      ['POST', '/confirm', 422, { refusal: 'MISMATCH' }],
      ['POST', '/api/tasks/3/attachments', 201, UPLOAD],
    ])

    await expect(uploadAttachment(3, file('Rechnung.pdf', 'application/pdf'), () => {})).rejects.toEqual(
      new AttachmentRefusedError('MISMATCH'),
    )
  })
})

describe('trusting what comes back about attachments', () => {
  it('reports no progress when the browser cannot tell how far an upload has got', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
    FakeXhr.computable = false
    backend([
      ['POST', '/confirm', 200, PDF_ATTACHMENT],
      ['POST', '/api/tasks/3/attachments', 201, UPLOAD],
    ])
    const progress: number[] = []

    await uploadAttachment(3, file('Rechnung.pdf', 'application/pdf'), (fraction) => progress.push(fraction))

    expect(progress).toEqual([])
  })

  it('fails as an upload on a refusal it cannot read', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(new Response('not json', { status: 422 }))) as unknown as typeof fetch

    await expect(uploadAttachment(3, file('Rechnung.pdf', 'application/pdf'), () => {})).rejects.toEqual(
      new RequestError('uploadAttachment'),
    )
  })

  it('rejects an upload link that breaks the contract', async () => {
    backend([['POST', '/api/tasks/3/attachments', 201, { ...UPLOAD, url: 42 }]])

    await expect(uploadAttachment(3, file('Rechnung.pdf', 'application/pdf'), () => {})).rejects.toEqual(
      new ContractBreachError('attachment'),
    )
  })

  it('rejects a confirmed attachment that breaks the contract', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
    backend([
      ['POST', '/confirm', 200, { ...PDF_ATTACHMENT, fileName: null }],
      ['POST', '/api/tasks/3/attachments', 201, UPLOAD],
    ])

    await expect(uploadAttachment(3, file('Rechnung.pdf', 'application/pdf'), () => {})).rejects.toEqual(
      new ContractBreachError('attachment'),
    )
  })

  it('rejects a link that breaks the contract', async () => {
    backend([['GET', '/link', 200, { url: 'https://bucket.example.com/k' }]])

    await expect(attachmentLink(3, 7)).rejects.toEqual(new ContractBreachError('attachmentLink'))
  })

  it('rejects an attachment whose id is not an exact integer', async () => {
    backend([['GET', '/api/tasks', 200, [{ id: 3, description: 'Pay', dueDate: '2099-01-01', importance: 'LOW', state: 'TODO', attachments: [{ ...PDF_ATTACHMENT, id: 2 ** 60 }] }]]])

    await expect(fetchTasks()).rejects.toEqual(new ContractBreachError('task', 'idNotInteger'))
  })

  it('will not address an attachment by an id that is not one', async () => {
    const calls = backend([])

    await expect(attachmentLink(3, 1.5)).rejects.toEqual(new RequestError('unaddressable'))
    expect(calls).toEqual([])
  })
})

describe('opening and removing an attachment', () => {
  it('asks for a link to open the file', async () => {
    backend([['GET', '/api/tasks/3/attachments/7/link', 200, { url: 'https://bucket.example.com/k', expiresAt: UPLOAD.expiresAt }]])

    await expect(attachmentLink(3, 7)).resolves.toBe('https://bucket.example.com/k')
  })

  it('fails by name when no link comes back', async () => {
    backend([])

    await expect(attachmentLink(3, 7)).rejects.toEqual(new RequestError('openAttachment'))
  })

  it('removes the file', async () => {
    const calls = backend([['DELETE', '/api/tasks/3/attachments/7', 204, null]])

    await removeAttachment(3, 7)

    expect(calls).toEqual([{ method: 'DELETE', url: '/api/tasks/3/attachments/7', body: undefined }])
  })

  it('fails by name when the file could not be removed', async () => {
    backend([['DELETE', '/api/tasks/3/attachments/7', 500, null]])

    await expect(removeAttachment(3, 7)).rejects.toEqual(new RequestError('removeAttachment'))
  })
})

describe('a task with attachments', () => {
  const TASK: Task = { id: 3, description: 'Pay', dueDate: '2099-01-01', importance: 'LOW', state: 'TODO' }

  it('keeps the attachments a task arrives with', async () => {
    backend([['GET', '/api/tasks', 200, [{ ...TASK, attachments: [PDF_ATTACHMENT] }]]])

    await expect(fetchTasks()).resolves.toEqual([{ ...TASK, attachments: [PDF_ATTACHMENT] }])
  })

  it('brings its attachments back with an undo', async () => {
    const calls = backend([['POST', '/api/tasks', 201, { ...TASK, id: 9, attachments: [PDF_ATTACHMENT] }]])

    const restored = await restoreTask({ ...TASK, attachments: [PDF_ATTACHMENT] }, '2026-10-08')

    expect(calls[0].body).toEqual({
      description: 'Pay',
      dueDate: '2099-01-01',
      importance: 'LOW',
      state: 'TODO',
      attachmentIds: [7],
    })
    expect(restored.attachments).toEqual([PDF_ATTACHMENT])
  })
})

describe('a preview thumbnail (#236)', () => {
  const PHOTO = { id: 8, fileName: 'beach.jpg', contentType: 'image/jpeg', sizeBytes: 12, thumbnail: true }
  const THUMBNAIL_UPLOAD = { url: 'https://bucket.example.com/key.thumbnail?sig', headers: { 'Content-Type': 'image/jpeg' } }
  const PHOTO_UPLOAD = { ...UPLOAD, attachment: { ...PHOTO, thumbnail: false }, thumbnailUpload: THUMBNAIL_UPLOAD }
  const small = new Blob(['tiny'], { type: 'image/jpeg' })

  it('announces an image with its thumbnail, PUTs both, and only then confirms', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
    const calls = backend([
      ['POST', '/api/tasks/3/attachments/8/confirm', 200, PHOTO],
      ['POST', '/api/tasks/3/attachments', 201, PHOTO_UPLOAD],
    ])
    const photo = file('beach.jpg', 'image/jpeg')

    await expect(uploadAttachment(3, photo, () => {}, async () => small)).resolves.toEqual(PHOTO)

    expect(calls[0].body).toEqual({ fileName: 'beach.jpg', contentType: 'image/jpeg', sizeBytes: 12, thumbnailSizeBytes: 4 })
    expect(storage.sent).toEqual([
      { method: 'PUT', url: UPLOAD.url, headers: UPLOAD.headers, body: photo },
      { method: 'PUT', url: THUMBNAIL_UPLOAD.url, headers: THUMBNAIL_UPLOAD.headers, body: small },
    ])
    expect(calls[1]).toMatchObject({ method: 'POST', url: '/api/tasks/3/attachments/8/confirm' })
  })

  it('uploads an image without one when none could be made', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
    const calls = backend([
      ['POST', '/api/tasks/3/attachments/8/confirm', 200, { ...PHOTO, thumbnail: false }],
      ['POST', '/api/tasks/3/attachments', 201, { ...UPLOAD, attachment: { ...PHOTO, thumbnail: false } }],
    ])

    await uploadAttachment(3, file('beach.jpg', 'image/jpeg'), () => {}, async () => null)

    expect(calls[0].body).toEqual({ fileName: 'beach.jpg', contentType: 'image/jpeg', sizeBytes: 12 })
    expect(storage.sent).toHaveLength(1)
  })

  it('makes none for a PDF', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
    backend([
      ['POST', '/api/tasks/3/attachments/7/confirm', 200, PDF_ATTACHMENT],
      ['POST', '/api/tasks/3/attachments', 201, UPLOAD],
    ])
    const make = vi.fn(async () => small)

    await uploadAttachment(3, file('Rechnung.pdf', 'application/pdf'), () => {}, make)

    expect(make).not.toHaveBeenCalled()
  })

  it('keeps the file when its thumbnail does not make it to storage', async () => {
    let puts = 0
    class ThumbnailRefused extends FakeXhr {
      send(body: unknown) {
        puts += 1
        storage.status = puts === 1 ? 200 : 403
        super.send(body)
      }
    }
    vi.stubGlobal('XMLHttpRequest', ThumbnailRefused)
    const calls = backend([
      ['POST', '/api/tasks/3/attachments/8/confirm', 200, { ...PHOTO, thumbnail: false }],
      ['POST', '/api/tasks/3/attachments', 201, PHOTO_UPLOAD],
    ])

    await expect(uploadAttachment(3, file('beach.jpg', 'image/jpeg'), () => {}, async () => small)).resolves.toEqual({
      ...PHOTO,
      thumbnail: false,
    })
    expect(calls[1]).toMatchObject({ url: '/api/tasks/3/attachments/8/confirm' })
  })

  it('asks for a link to the thumbnail', async () => {
    backend([['GET', '/api/tasks/3/attachments/8/thumbnail-link', 200, { url: 'https://thumb', expiresAt: '2026-10-08T11:00:00Z' }]])

    await expect(thumbnailLink(3, 8)).resolves.toBe('https://thumb')
  })
})

