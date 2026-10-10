import { isDevelopmentBuild, isTooOld } from './appVersion'

describe('whether this app is too old for the backend', () => {
  it('is, when the backend serves only newer releases', () => {
    expect(isTooOld('1.1.0', '1.2.0')).toBe(true)
    expect(isTooOld('1.9.9', '2.0.0')).toBe(true)
  })

  it('is not, at or above the minimum', () => {
    expect(isTooOld('1.2.0', '1.2.0')).toBe(false)
    expect(isTooOld('2.0.0', '1.9.9')).toBe(false)
  })

  it('compares the numbers, not the text', () => {
    expect(isTooOld('1.10.0', '1.9.0')).toBe(false)
  })

  it('never says so of a development build', () => {
    // Built from a branch, not a tag: 0.0.0. Nobody is to be told to update that.
    expect(isTooOld('0.0.0', '5.0.0')).toBe(false)
  })

  it('does not lock anyone out over a version it cannot read', () => {
    expect(isTooOld('1.0.0', 'soon')).toBe(false)
    expect(isTooOld('unknown', '1.0.0')).toBe(false)
  })
})

describe('a development build (#275)', () => {
  it('is one built from a branch: 0.0.0', () => {
    expect(isDevelopmentBuild('0.0.0')).toBe(true)
    expect(isDevelopmentBuild('1.2.0')).toBe(false)
    expect(isDevelopmentBuild('0.0.1')).toBe(false)
  })
})
