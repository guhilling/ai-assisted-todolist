import { AttachmentRefusedError, ContractBreachError, announceAttachment, confirmAttachment } from './api'

const BASE = 'https://taskfest.example'
const caller = { baseUrl: BASE, idToken: 'the-token', appVersion: '1.4.0' }

function respond(status: number, body?: unknown) {
  return jest.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as Response)
}

const attachment = { id: 9, fileName: 'photo.jpg', contentType: 'image/jpeg', sizeBytes: 2_000_000, thumbnail: false }
const announced = {
  attachment,
  url: 'https://bucket.example.com/upload?X-Amz-Signature=abc',
  headers: { 'Content-Type': 'image/jpeg' },
  expiresAt: '2026-10-18T09:15:00Z',
  thumbnailUpload: { url: 'https://bucket.example.com/thumb?X-Amz-Signature=def', headers: { 'Content-Type': 'image/jpeg' } },
}

describe('attaching a file, as the app asks the backend (#274)', () => {
  it('announces the file and hands back where to upload it, and its thumbnail', async () => {
    const fetchImpl = respond(201, announced)
    const file = { fileName: 'photo.jpg', contentType: 'image/jpeg', sizeBytes: 2_000_000, thumbnailSizeBytes: 20_000 }

    await expect(announceAttachment(caller, 7, file, fetchImpl)).resolves.toEqual({
      attachment,
      url: announced.url,
      headers: announced.headers,
      thumbnailUpload: announced.thumbnailUpload,
    })
    expect(fetchImpl).toHaveBeenCalledWith(`${BASE}/api/tasks/7/attachments`, {
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer the-token', 'Content-Type': 'application/json' }),
      body: JSON.stringify(file),
      signal: expect.any(AbortSignal),
    })
  })

  it('refuses to upload anywhere the storage rule does not allow', async () => {
    await expect(announceAttachment(caller, 7, file(), respond(201, { ...announced, url: 'http://elsewhere.example/x' }))).rejects.toBeInstanceOf(
      ContractBreachError,
    )
    const badThumbnail = { ...announced, thumbnailUpload: { ...announced.thumbnailUpload, url: 'ftp://x' } }
    await expect(announceAttachment(caller, 7, file(), respond(201, badThumbnail))).rejects.toBeInstanceOf(ContractBreachError)
  })

  it("says why the backend refused the file, by the backend's reason", async () => {
    const refusal = await announceAttachment(caller, 7, file(), respond(422, { refusal: 'TASK_FULL' })).catch((error: unknown) => error)

    expect(refusal).toBeInstanceOf(AttachmentRefusedError)
    expect((refusal as AttachmentRefusedError).refusal).toBe('TASK_FULL')
  })

  it('confirms the upload, and hands back the attachment as the backend now lists it', async () => {
    const fetchImpl = respond(200, { ...attachment, thumbnail: true })

    await expect(confirmAttachment(caller, 7, 9, fetchImpl)).resolves.toEqual({ ...attachment, thumbnail: true })
    expect(fetchImpl).toHaveBeenCalledWith(`${BASE}/api/tasks/7/attachments/9/confirm`, {
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer the-token' }),
      signal: expect.any(AbortSignal),
    })
  })

  it('says so when the file did not arrive as announced', async () => {
    await expect(confirmAttachment(caller, 7, 9, respond(422, { refusal: 'MISMATCH' }))).rejects.toMatchObject({ refusal: 'MISMATCH' })
  })

  it('refuses a confirmation that is no attachment', async () => {
    await expect(confirmAttachment(caller, 7, 9, respond(200, { id: 'nine' }))).rejects.toBeInstanceOf(ContractBreachError)
  })
})

function file() {
  return { fileName: 'photo.jpg', contentType: 'image/jpeg', sizeBytes: 2_000_000 }
}
