import { makeThumbnail, type ThumbnailParts } from './thumbnails'

/** A photo's thumbnail, made on the phone by the website's rule (#274, `frontend/src/thumbnail.ts`). */
function phone(size = 20_000): ThumbnailParts {
  return {
    dimensions: jest.fn().mockResolvedValue({ width: 4000, height: 3000 }),
    render: jest.fn().mockResolvedValue({ uri: 'file:///cache/thumb.jpg', size }),
  }
}

const photo = { uri: 'file:///cache/photo.jpg', name: 'photo.jpg', type: 'image/jpeg', size: 2_000_000 }

describe("a photo's thumbnail (#274)", () => {
  it("is the website's: 128 points on the short side, the whole photo, as a JPEG at 0.8", async () => {
    const parts = phone()

    await expect(makeThumbnail(photo, parts)).resolves.toEqual({ uri: 'file:///cache/thumb.jpg', size: 20_000 })
    expect(parts.render).toHaveBeenCalledWith(
      'file:///cache/photo.jpg',
      expect.objectContaining({ originX: expect.closeTo(0), width: expect.closeTo(4000) }),
      { width: 171, height: 128 },
    )
  })

  it('is none for a photo that would not be scaled down', async () => {
    const parts = phone()
    ;(parts.dimensions as jest.Mock).mockResolvedValue({ width: 100, height: 80 })

    await expect(makeThumbnail(photo, parts)).resolves.toBeNull()
    expect(parts.render).not.toHaveBeenCalled()
  })

  it('is none when it would be larger than the backend takes', async () => {
    await expect(makeThumbnail(photo, phone(70_000))).resolves.toBeNull()
  })
})
