/**
 * Preview thumbnails (#236): the size the canvas draws an image at, and making one -- against
 * stubbed `createImageBitmap` and canvas, since jsdom has neither; the e2e suite makes real ones.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeThumbnail, thumbnailSize } from './thumbnail'

describe('the size of a thumbnail', () => {
  it('covers the preview box twice over, for sharp pixels on a high-density screen', () => {
    // The row's box is 64 px and crops to fill it, so the shorter side is what has to fit.
    expect(thumbnailSize(4000, 3000)).toEqual({ width: 171, height: 128 })
    expect(thumbnailSize(3000, 4000)).toEqual({ width: 128, height: 171 })
  })

  it('never enlarges an image already that small', () => {
    expect(thumbnailSize(100, 80)).toEqual({ width: 100, height: 80 })
  })

  it('keeps a very long panorama within reason', () => {
    expect(thumbnailSize(20000, 1000)).toEqual({ width: 512, height: 128 })
  })
})

describe('making a thumbnail', () => {
  // Larger than a thumbnail may be: a file that small is shown as it is.
  const photo = new File(['x'.repeat(64 * 1024 + 1)], 'beach.jpg', { type: 'image/jpeg' })
  const bitmap = { width: 4000, height: 1000, close: vi.fn() }

  function browser(options: { written?: Blob | null; context?: boolean; size?: { width: number; height: number } } = {}) {
    const context = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() }
    bitmap.close = vi.fn()
    Object.assign(bitmap, options.size ?? { width: 4000, height: 1000 })
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      (options.context === false ? null : context) as unknown as CanvasRenderingContext2D,
    )
    const written = options.written === undefined ? new Blob(['jpeg'], { type: 'image/jpeg' }) : options.written
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((done) => done(written))
    return context
  }

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('draws the middle of the image at its size, on white, as a JPEG', async () => {
    const context = browser()

    const thumbnail = await makeThumbnail(photo)

    expect(thumbnail?.type).toBe('image/jpeg')
    expect(context.fillStyle).toBe('#fff')
    // 4000 x 1000 at 128 high would be 512 wide: exactly the longest side, so all of it is drawn.
    expect(context.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 4000, 1000, 0, 0, 512, 128)
  })

  it('turns the image the way its camera meant, as the full image is shown', async () => {
    browser()

    await makeThumbnail(photo)

    expect(createImageBitmap).toHaveBeenCalledWith(photo, { imageOrientation: 'from-image' })
  })

  it('makes none for a file already small enough to show as it is', async () => {
    // A small PNG keeps its transparency and a GIF its animation that way.
    browser()

    expect(await makeThumbnail(new File(['x'.repeat(1000)], 'icon.png', { type: 'image/png' }))).toBeNull()
    expect(createImageBitmap).not.toHaveBeenCalled()
  })

  it('makes none for an image that would not be scaled down', async () => {
    browser({ size: { width: 120, height: 100 } })

    expect(await makeThumbnail(photo)).toBeNull()
    expect(bitmap.close).toHaveBeenCalled()
  })

  it('makes none where the browser cannot decode images for a canvas', async () => {
    expect(await makeThumbnail(photo)).toBeNull()
  })

  it('makes none when the image cannot be read', async () => {
    browser()
    vi.stubGlobal('createImageBitmap', vi.fn(async () => Promise.reject(new Error('broken'))))

    expect(await makeThumbnail(photo)).toBeNull()
  })

  it('makes none without a canvas to draw on, and lets go of the decoded image', async () => {
    browser({ context: false })

    expect(await makeThumbnail(photo)).toBeNull()
    expect(bitmap.close).toHaveBeenCalled()
  })

  it('makes none when the browser writes no JPEG, or one too large', async () => {
    browser({ written: new Blob(['png'], { type: 'image/png' }) })
    expect(await makeThumbnail(photo)).toBeNull()

    vi.restoreAllMocks()
    browser({ written: new Blob(['x'.repeat(64 * 1024 + 1)], { type: 'image/jpeg' }) })
    expect(await makeThumbnail(photo)).toBeNull()

    vi.restoreAllMocks()
    browser({ written: null })
    expect(await makeThumbnail(photo)).toBeNull()
  })
})
