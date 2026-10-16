import { releaseOf } from './release'

describe('a build’s release numbers', () => {
  it('takes the version from the release tag and the build number from the release run', () => {
    expect(releaseOf({ TASKFEST_VERSION: '1.4.0', TASKFEST_BUILD_NUMBER: '57' })).toEqual({
      version: '1.4.0',
      buildNumber: 57,
    })
  })

  it('is 0.0.0, build 1, for a build from a branch', () => {
    expect(releaseOf({})).toEqual({ version: '0.0.0', buildNumber: 1 })
  })

  it('refuses a build number the stores would not take', () => {
    for (const bad of ['0', '-3', '1.5', 'abc', '']) {
      expect(() => releaseOf({ TASKFEST_BUILD_NUMBER: bad })).toThrow(/TASKFEST_BUILD_NUMBER/)
    }
  })

  it('refuses a version that is not three numbers, which is all a store accepts', () => {
    expect(() => releaseOf({ TASKFEST_VERSION: '1.4.0-rc.1' })).toThrow(/TASKFEST_VERSION/)
  })
})
