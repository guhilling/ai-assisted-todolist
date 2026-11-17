import { APPLE_SIGN_IN_ENTITLEMENT, withoutAppleSignIn } from './appleEntitlement'

describe('Sign in with Apple’s entitlement, in a build without it (#281)', () => {
  it('takes out the entitlement expo-apple-authentication’s plugin adds to every build', () => {
    const entitlements = { [APPLE_SIGN_IN_ENTITLEMENT]: ['Default'], 'com.apple.security.application-groups': ['group.de.hilling.taskfest'] }

    expect(withoutAppleSignIn(entitlements)).toEqual({ 'com.apple.security.application-groups': ['group.de.hilling.taskfest'] })
  })

  it('leaves entitlements without it as they are', () => {
    expect(withoutAppleSignIn({})).toEqual({})
  })

  it('names the entitlement Apple names', () => {
    expect(APPLE_SIGN_IN_ENTITLEMENT).toBe('com.apple.developer.applesignin')
  })
})
