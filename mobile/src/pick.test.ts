import { CameraRefusedError, pickFile, type PickerParts } from './pick'

/** Picking a file to attach (#274): a photo taken or chosen, or any file, as the pickers report it. */
function phone(overrides: Partial<PickerParts> = {}): PickerParts {
  return {
    cameraAllowed: jest.fn().mockResolvedValue(true),
    camera: jest.fn().mockResolvedValue({ uri: 'file:///cache/camera.jpg', fileName: null, mimeType: 'image/jpeg', fileSize: 2_000_000 }),
    library: jest.fn().mockResolvedValue({ uri: 'file:///cache/IMG_1.jpg', fileName: 'IMG_1.jpg', mimeType: 'image/jpeg', fileSize: 1_500_000 }),
    files: jest.fn().mockResolvedValue({ uri: 'file:///cache/scan.pdf', name: 'scan.pdf', type: 'application/pdf', size: 90_000 }),
    sizeOf: jest.fn().mockReturnValue(1234),
    toJpeg: jest.fn().mockResolvedValue({ uri: 'file:///cache/converted.jpg', size: 900_000 }),
    now: () => Date.UTC(2026, 9, 18, 9, 30),
    ...overrides,
  }
}

describe('picking a file to attach (#274)', () => {
  it('takes a photo, named for when it was taken when the camera gives it no name', async () => {
    await expect(pickFile('camera', phone())).resolves.toEqual({
      uri: 'file:///cache/camera.jpg',
      name: 'photo-2026-10-18-0930.jpg',
      type: 'image/jpeg',
      size: 2_000_000,
    })
  })

  it('asks for the camera first, and says so when it is not allowed', async () => {
    const parts = phone({ cameraAllowed: jest.fn().mockResolvedValue(false) })

    await expect(pickFile('camera', parts)).rejects.toBeInstanceOf(CameraRefusedError)
    expect(parts.camera).not.toHaveBeenCalled()
  })

  it('chooses a photo from the library as it is', async () => {
    await expect(pickFile('library', phone())).resolves.toEqual({
      uri: 'file:///cache/IMG_1.jpg',
      name: 'IMG_1.jpg',
      type: 'image/jpeg',
      size: 1_500_000,
    })
  })

  it("turns an iPhone's HEIC photo into a JPEG, which the backend takes", async () => {
    const parts = phone({
      library: jest.fn().mockResolvedValue({ uri: 'file:///cache/IMG_2.HEIC', fileName: 'IMG_2.HEIC', mimeType: 'image/heic', fileSize: 1_000_000 }),
    })

    await expect(pickFile('library', parts)).resolves.toEqual({
      uri: 'file:///cache/converted.jpg',
      name: 'IMG_2.jpg',
      type: 'image/jpeg',
      size: 900_000,
    })
    expect(parts.toJpeg).toHaveBeenCalledWith('file:///cache/IMG_2.HEIC')
  })

  it('goes by the name, and asks the file for its size, when the picker does not say', async () => {
    const parts = phone({
      library: jest.fn().mockResolvedValue({ uri: 'file:///cache/drawing.png', fileName: 'drawing.png', mimeType: null, fileSize: null }),
    })

    await expect(pickFile('library', parts)).resolves.toEqual({
      uri: 'file:///cache/drawing.png',
      name: 'drawing.png',
      type: 'image/png',
      size: 1234,
    })
  })

  it('chooses any file, as the file picker reports it', async () => {
    await expect(pickFile('files', phone())).resolves.toEqual({
      uri: 'file:///cache/scan.pdf',
      name: 'scan.pdf',
      type: 'application/pdf',
      size: 90_000,
    })
  })

  it('picks nothing when the user turns back', async () => {
    const parts = phone({ camera: jest.fn().mockResolvedValue(null), library: jest.fn().mockResolvedValue(null), files: jest.fn().mockResolvedValue(null) })

    await expect(pickFile('camera', parts)).resolves.toBeNull()
    await expect(pickFile('library', parts)).resolves.toBeNull()
    await expect(pickFile('files', parts)).resolves.toBeNull()
  })
})
