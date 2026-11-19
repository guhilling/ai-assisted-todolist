import { AppleAuthenticationScope } from 'expo-apple-authentication'
import { appleProviderFor, appleSignInFor, type AppleAuthentication } from './apple'

function apple(overrides: Partial<AppleAuthentication> = {}): AppleAuthentication {
  return {
    isAvailableAsync: jest.fn().mockResolvedValue(true),
    signInAsync: jest.fn().mockResolvedValue({ identityToken: 'apple-id-token' }),
    ...overrides,
  }
}

describe('Sign in with Apple, on the phone (#281)', () => {
  it('signs in natively, asking for the address alone, and hands over Apple’s ID token', async () => {
    const native = apple()

    await expect(appleProviderFor(native).signIn()).resolves.toEqual({ idToken: 'apple-id-token' })
    expect(native.signInAsync).toHaveBeenCalledWith({ requestedScopes: [AppleAuthenticationScope.EMAIL] })
  })

  it('takes a sign-in turned away for no sign-in, and anything else for a failure', async () => {
    const canceled = Object.assign(new Error('canceled'), { code: 'ERR_REQUEST_CANCELED' })
    const failed = Object.assign(new Error('failed'), { code: 'ERR_REQUEST_FAILED' })

    await expect(appleProviderFor(apple({ signInAsync: jest.fn().mockRejectedValue(canceled) })).signIn()).resolves.toBeNull()
    await expect(appleProviderFor(apple({ signInAsync: jest.fn().mockRejectedValue(failed) })).signIn()).rejects.toBe(failed)
  })

  it('fails a sign-in that brings no ID token', async () => {
    const native = apple({ signInAsync: jest.fn().mockResolvedValue({ identityToken: null }) })

    await expect(appleProviderFor(native).signIn()).rejects.toThrow('no ID token')
  })

  it('says whether the phone can sign in with Apple, and that it cannot when asking fails', async () => {
    await expect(appleProviderFor(apple()).available()).resolves.toBe(true)
    await expect(appleProviderFor(apple({ isAvailableAsync: jest.fn().mockResolvedValue(false) })).available()).resolves.toBe(false)
    await expect(appleProviderFor(apple({ isAvailableAsync: jest.fn().mockRejectedValue(new Error('no')) })).available()).resolves.toBe(false)
  })
})

describe('Apple confirming an account’s deletion (#635)', () => {
  it('runs Apple’s sheet once more, asking for nothing, and hands over the code it issues', async () => {
    const native = apple({ signInAsync: jest.fn().mockResolvedValue({ identityToken: 'apple-id-token', authorizationCode: 'code-1' }) })

    await expect(appleProviderFor(native).confirm()).resolves.toBe('code-1')
    expect(native.signInAsync).toHaveBeenCalledWith({ requestedScopes: [] })
  })

  it('takes the sheet turned away for no confirmation, and anything else for a failure', async () => {
    const canceled = Object.assign(new Error('canceled'), { code: 'ERR_REQUEST_CANCELED' })
    const failed = Object.assign(new Error('failed'), { code: 'ERR_REQUEST_FAILED' })

    await expect(appleProviderFor(apple({ signInAsync: jest.fn().mockRejectedValue(canceled) })).confirm()).resolves.toBeNull()
    await expect(appleProviderFor(apple({ signInAsync: jest.fn().mockRejectedValue(failed) })).confirm()).rejects.toBe(failed)
  })

  it('fails a confirmation that brings no code', async () => {
    const native = apple({ signInAsync: jest.fn().mockResolvedValue({ identityToken: 'apple-id-token', authorizationCode: null }) })

    await expect(appleProviderFor(native).confirm()).rejects.toThrow('no authorization code')
  })
})

describe('where Sign in with Apple is offered (#281)', () => {
  it('on iOS, where the build has it', () => {
    expect(appleSignInFor({ apple: true }, 'ios', apple())).toBeDefined()
  })

  it('nowhere else: not where the build lacks it, and never on Android', () => {
    expect(appleSignInFor({}, 'ios', apple())).toBeUndefined()
    expect(appleSignInFor({ apple: true }, 'android', apple())).toBeUndefined()
  })
})
