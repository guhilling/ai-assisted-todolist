import { REQUEST_MS, SLOWEST_BYTES_PER_SECOND, transferMs } from './timeLimit'

/**
 * How long a file's transfer is waited for (#432): a request's time, and as long again as the
 * slowest connection waited for takes over the file -- so a large file on a slow line still
 * arrives, and a hung one still ends.
 */
describe('the time a transfer may take (#432)', () => {
  it("is a request's time for a file of nothing", () => {
    expect(transferMs(0)).toBe(REQUEST_MS)
  })

  it('grows with the file, at the slowest rate waited for', () => {
    expect(transferMs(SLOWEST_BYTES_PER_SECOND * 30)).toBe(REQUEST_MS + 30_000)
  })

  it('counts a part of a second as a whole one', () => {
    expect(transferMs(1)).toBe(REQUEST_MS + 1000)
  })

  it('ends within three minutes for the largest file the backend takes', () => {
    expect(transferMs(10 * 1024 * 1024)).toBeLessThanOrEqual(180_000)
  })
})
