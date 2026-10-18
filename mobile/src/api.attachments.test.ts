import { ContractBreachError, RequestFailedError, SignedOutError, attachmentLink, removeAttachment } from './api'

const BASE = 'https://taskfest.example'
const caller = { baseUrl: BASE, idToken: 'the-token', appVersion: '1.4.0' }

function respond(status: number, body?: unknown) {
  return jest.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as Response)
}

const signedIn = { Accept: 'application/json', Authorization: 'Bearer the-token', 'X-TaskFest-App': '1.4.0' }
const link = { url: 'https://bucket.example.com/photo.jpg?X-Amz-Signature=abc', expiresAt: '2026-10-18T09:15:00Z' }

describe("a task's files, as the app asks the backend for them (#274)", () => {
  it('asks for a link to the file, and hands it back exactly as signed, with when it runs out', async () => {
    const fetchImpl = respond(200, link)

    await expect(attachmentLink(caller, 7, 3, false, fetchImpl)).resolves.toEqual({
      url: link.url,
      expiresAt: Date.parse(link.expiresAt),
    })
    expect(fetchImpl).toHaveBeenCalledWith(`${BASE}/api/tasks/7/attachments/3/link`, {
      headers: signedIn,
      signal: expect.any(AbortSignal),
    })
  })

  it("asks for the thumbnail's link instead when it is the preview that is wanted", async () => {
    const fetchImpl = respond(200, link)

    await attachmentLink(caller, 7, 3, true, fetchImpl)

    expect(fetchImpl).toHaveBeenCalledWith(`${BASE}/api/tasks/7/attachments/3/thumbnail-link`, expect.anything())
  })

  it.each([
    ['plain HTTP elsewhere', 'http://bucket.example.com/photo.jpg'],
    ['another scheme', 'javascript:alert(1)'],
    ['no address at all', 'not a link'],
  ])('refuses a link that is %s, as the website does', async (_case, url) => {
    await expect(attachmentLink(caller, 7, 3, false, respond(200, { ...link, url }))).rejects.toBeInstanceOf(ContractBreachError)
  })

  it("accepts plain HTTP to the end-to-end stack's storage on this machine", async () => {
    const local = 'http://localhost:9000/taskfest/photo.jpg?sig=1'

    await expect(attachmentLink(caller, 7, 3, false, respond(200, { ...link, url: local }))).resolves.toMatchObject({ url: local })
  })

  it('refuses an answer that is no link', async () => {
    await expect(attachmentLink(caller, 7, 3, false, respond(200, { link: 'x' }))).rejects.toBeInstanceOf(ContractBreachError)
  })

  it('removes a file for good', async () => {
    const fetchImpl = respond(204)

    await expect(removeAttachment(caller, 7, 3, fetchImpl)).resolves.toBeUndefined()
    expect(fetchImpl).toHaveBeenCalledWith(`${BASE}/api/tasks/7/attachments/3`, {
      method: 'DELETE',
      headers: signedIn,
      signal: expect.any(AbortSignal),
    })
  })

  it('says when the sign-in was refused, or the backend failed', async () => {
    await expect(removeAttachment(caller, 7, 3, respond(401))).rejects.toBeInstanceOf(SignedOutError)
    await expect(attachmentLink(caller, 7, 3, false, respond(404))).rejects.toBeInstanceOf(RequestFailedError)
  })
})
