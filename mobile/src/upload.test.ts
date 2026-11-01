import { AttachmentRefusedError } from './api'
import { uploadFile, type PickedFile, type UploadApi, type UploadParts } from './upload'

/**
 * Attaching a file from the phone (#274), as the website does it: refused on the phone when the
 * backend would refuse it anyway, announced, uploaded straight to storage beside its thumbnail, and
 * confirmed. The content never passes through the backend.
 */

const caller = { baseUrl: 'https://taskfest.example', idToken: 'the-token' }
const attachment = { id: 9, fileName: 'photo.jpg', contentType: 'image/jpeg', sizeBytes: 2_000_000, thumbnail: true }
const photo: PickedFile = { uri: 'file:///cache/photo.jpg', name: 'photo.jpg', type: 'image/jpeg', size: 2_000_000 }

function backend(thumbnailUpload = true): UploadApi {
  return {
    announce: jest.fn().mockResolvedValue({
      attachment: { ...attachment, thumbnail: false },
      url: 'https://bucket.example.com/upload',
      headers: { 'Content-Type': 'image/jpeg' },
      ...(thumbnailUpload ? { thumbnailUpload: { url: 'https://bucket.example.com/thumb', headers: { 'Content-Type': 'image/jpeg' } } } : {}),
    }),
    confirm: jest.fn().mockResolvedValue(attachment),
  }
}

function phone(overrides: Partial<UploadParts> = {}): UploadParts {
  return {
    put: jest.fn().mockResolvedValue(undefined),
    thumbnail: jest.fn().mockResolvedValue({ uri: 'file:///cache/thumb.jpg', size: 20_000 }),
    ...overrides,
  }
}

describe('attaching a file from the phone (#274)', () => {
  it('announces the photo with its thumbnail, uploads both to storage, and confirms it', async () => {
    const api = backend()
    const parts = phone()
    const onProgress = jest.fn()

    await expect(uploadFile(caller, 7, photo, onProgress, api, parts)).resolves.toEqual(attachment)

    expect(api.announce).toHaveBeenCalledWith(caller, 7, {
      fileName: 'photo.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 2_000_000,
      thumbnailSizeBytes: 20_000,
    })
    expect(parts.put).toHaveBeenCalledWith('file:///cache/photo.jpg', 'https://bucket.example.com/upload', { 'Content-Type': 'image/jpeg' }, onProgress)
    expect(parts.put).toHaveBeenCalledWith('file:///cache/thumb.jpg', 'https://bucket.example.com/thumb', { 'Content-Type': 'image/jpeg' }, undefined)
    expect(api.confirm).toHaveBeenCalledWith(caller, 7, 9)
  })

  it('makes no thumbnail for a file small enough to show itself, or for a PDF', async () => {
    const parts = phone()
    const api = backend(false)

    await uploadFile(caller, 7, { ...photo, size: 60_000 }, jest.fn(), api, parts)
    await uploadFile(caller, 7, { uri: 'file:///cache/scan.pdf', name: 'scan.pdf', type: 'application/pdf', size: 90_000 }, jest.fn(), api, parts)

    expect(parts.thumbnail).not.toHaveBeenCalled()
    expect(api.announce).toHaveBeenCalledWith(caller, 7, { fileName: 'scan.pdf', contentType: 'application/pdf', sizeBytes: 90_000 })
  })

  it('makes none for a PNG either, whose transparency a JPEG thumbnail would lose', async () => {
    const parts = phone()

    await uploadFile(caller, 7, { ...photo, name: 'sketch.png', type: 'image/png' }, jest.fn(), backend(false), parts)

    expect(parts.thumbnail).not.toHaveBeenCalled()
  })

  it('attaches the file without a thumbnail when none could be made, or it did not arrive', async () => {
    const api = backend(false)
    await uploadFile(caller, 7, photo, jest.fn(), api, phone({ thumbnail: jest.fn().mockRejectedValue(new Error('no decoder')) }))
    expect(api.announce).toHaveBeenCalledWith(caller, 7, { fileName: 'photo.jpg', contentType: 'image/jpeg', sizeBytes: 2_000_000 })

    const put = jest.fn((uri: string) => (uri.includes('thumb') ? Promise.reject(new Error('lost')) : Promise.resolve()))
    await expect(uploadFile(caller, 7, photo, jest.fn(), backend(), phone({ put }))).resolves.toEqual(attachment)
  })

  it.each([
    ['of a type the backend does not take', { ...photo, name: 'photo.heic', type: 'image/heic' }, 'UNSUPPORTED_TYPE'],
    ['empty', { ...photo, size: 0 }, 'EMPTY'],
    ['larger than the limit', { ...photo, size: 11 * 1024 * 1024 }, 'TOO_LARGE'],
  ])('refuses a file %s before asking anyone, as the website does', async (_case, file, refusal) => {
    const api = backend()

    await expect(uploadFile(caller, 7, file, jest.fn(), api, phone())).rejects.toEqual(new AttachmentRefusedError(refusal as never))
    expect(api.announce).not.toHaveBeenCalled()
  })

  it('refuses a file whose type nobody could say, as one the backend does not take', async () => {
    const api = backend()

    await expect(uploadFile(caller, 7, { ...photo, name: 'IMG_4.DNG', type: '' }, jest.fn(), api, phone())).rejects.toEqual(
      new AttachmentRefusedError('UNSUPPORTED_TYPE'),
    )
    expect(api.announce).not.toHaveBeenCalled()
  })

  it('confirms nothing when the file did not reach storage', async () => {
    const api = backend()

    await expect(uploadFile(caller, 7, photo, jest.fn(), api, phone({ put: jest.fn().mockRejectedValue(new Error('offline')) }))).rejects.toThrow(
      'offline',
    )
    expect(api.confirm).not.toHaveBeenCalled()
  })
})

describe("a photo's thumbnail is let go once it is uploaded (#432)", () => {
  it('after it reached storage', async () => {
    const discard = jest.fn()

    await uploadFile(caller, 7, photo, jest.fn(), backend(), phone({ discard }))

    expect(discard).toHaveBeenCalledWith('file:///cache/thumb.jpg')
  })

  it('when the photo did not reach storage, too', async () => {
    const discard = jest.fn()
    const put = jest.fn((uri: string) => (uri.includes('thumb') ? Promise.resolve() : Promise.reject(new Error('offline'))))

    await expect(uploadFile(caller, 7, photo, jest.fn(), backend(), phone({ put, discard }))).rejects.toThrow('offline')

    expect(discard).toHaveBeenCalledWith('file:///cache/thumb.jpg')
  })

  it('not while it is still on its way, though the photo failed first', async () => {
    const discard = jest.fn()
    let thumbnailArrives: () => void = () => undefined
    const put = jest.fn((uri: string) =>
      uri.includes('thumb') ? new Promise<void>((resolve) => (thumbnailArrives = resolve)) : Promise.reject(new Error('offline')),
    )
    const upload = uploadFile(caller, 7, photo, jest.fn(), backend(), phone({ put, discard }))
    const settled = jest.fn()
    void upload.catch(settled)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(discard).not.toHaveBeenCalled()

    thumbnailArrives()

    await expect(upload).rejects.toThrow('offline')
    expect(discard).toHaveBeenCalledWith('file:///cache/thumb.jpg')
  })

  it('when the backend wanted none', async () => {
    const discard = jest.fn()

    await uploadFile(caller, 7, photo, jest.fn(), backend(false), phone({ discard }))

    expect(discard).toHaveBeenCalledWith('file:///cache/thumb.jpg')
  })
})
