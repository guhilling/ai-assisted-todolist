import { googleProviderFor, type GoogleSdk } from './google'

const WEB = '1234-web.apps.googleusercontent.com'
const IOS = '1234-ios.apps.googleusercontent.com'

function sdk(overrides: Partial<GoogleSdk> = {}): GoogleSdk & { [K in keyof GoogleSdk]: jest.Mock } {
  return {
    configure: jest.fn(),
    presentExplicitSignIn: jest.fn(),
    signIn: jest.fn(),
    getTokens: jest.fn(),
    signOut: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as GoogleSdk & { [K in keyof GoogleSdk]: jest.Mock }
}

function success(idToken: string) {
  return { type: 'success', data: { idToken, user: { id: 'u' }, scopes: [], serverAuthCode: null } }
}

describe('signing in with Google (#280)', () => {
  it('asks for ID tokens for the web client, the audience the backend accepts', async () => {
    const google = sdk({ presentExplicitSignIn: jest.fn().mockResolvedValue(success('id-1')) })

    await googleProviderFor({ webClientId: WEB, iosClientId: IOS }, google, 'android').signIn()

    expect(google.configure).toHaveBeenCalledWith({ webClientId: WEB, iosClientId: IOS, autoSelectOnSignIn: true })
  })

  it('hands back the ID token, or nothing when the user turned back', async () => {
    const google = sdk({
      presentExplicitSignIn: jest
        .fn()
        .mockResolvedValueOnce(success('id-1'))
        .mockResolvedValueOnce({ type: 'cancelled', data: null }),
    })
    const provider = googleProviderFor({ webClientId: WEB, iosClientId: IOS }, google, 'ios')

    await expect(provider.signIn()).resolves.toEqual({ idToken: 'id-1' })
    await expect(provider.signIn()).resolves.toBeNull()
  })

  it('renews on Android by signing in again silently: the token Credential Manager keeps is not renewed', async () => {
    const google = sdk({ signIn: jest.fn().mockResolvedValue(success('id-2')) })

    await expect(googleProviderFor({ webClientId: WEB, iosClientId: IOS }, google, 'android').renew()).resolves.toEqual({
      idToken: 'id-2',
    })
    expect(google.getTokens).not.toHaveBeenCalled()
  })

  it('renews on iOS by restoring the sign-in, then asking for fresh tokens', async () => {
    const google = sdk({
      signIn: jest.fn().mockResolvedValue(success('id-stale')),
      getTokens: jest.fn().mockResolvedValue({ idToken: 'id-2', accessToken: 'a' }),
    })

    await expect(googleProviderFor({ webClientId: WEB, iosClientId: IOS }, google, 'ios').renew()).resolves.toEqual({
      idToken: 'id-2',
    })
  })

  it('reports a renewal Google refuses as a refusal, which ends the session', async () => {
    const provider = googleProviderFor(
      { webClientId: WEB, iosClientId: IOS },
      sdk({ signIn: jest.fn().mockResolvedValue({ type: 'noSavedCredentialFound', data: null }) }),
      'android',
    )
    await expect(provider.renew()).rejects.toMatchObject({ code: 'invalid_grant' })

    const signedOut = googleProviderFor(
      { webClientId: WEB, iosClientId: IOS },
      sdk({ signIn: jest.fn().mockRejectedValue(Object.assign(new Error('none'), { code: 'SIGN_IN_REQUIRED' })) }),
      'ios',
    )
    await expect(signedOut.renew()).rejects.toMatchObject({ code: 'invalid_grant' })
  })

  it('passes any other failure on, so the session is kept for later', async () => {
    const offline = new Error('network')
    const provider = googleProviderFor(
      { webClientId: WEB, iosClientId: IOS },
      sdk({ signIn: jest.fn().mockRejectedValue(offline) }),
      'android',
    )

    await expect(provider.renew()).rejects.toBe(offline)
  })

  it('configures the SDK once', async () => {
    const google = sdk({ signIn: jest.fn().mockResolvedValue(success('id')), presentExplicitSignIn: jest.fn().mockResolvedValue(success('id')) })
    const provider = googleProviderFor({ webClientId: WEB, iosClientId: IOS }, google, 'android')

    await provider.signIn()
    await provider.renew()
    await provider.signOut()

    expect(google.configure).toHaveBeenCalledTimes(1)
    expect(google.signOut).toHaveBeenCalled()
  })

  it('keeps the session when the user only turned the account sheet away: Google did not refuse', async () => {
    const provider = googleProviderFor(
      { webClientId: WEB, iosClientId: IOS },
      sdk({ signIn: jest.fn().mockResolvedValue({ type: 'cancelled', data: null }) }),
      'android',
    )

    const failure = await provider.renew().catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    expect((failure as { code?: string }).code).not.toBe('invalid_grant')
  })

  it('takes a revoked grant on iOS for a refusal, though the SDK reports it as a general failure', async () => {
    const revoked = Object.assign(new Error('invalid_grant: Token has been expired or revoked.'), { code: 'ONE_TAP_START_FAILED' })
    const provider = googleProviderFor(
      { webClientId: WEB, iosClientId: IOS },
      sdk({ signIn: jest.fn().mockResolvedValue(success('id')), getTokens: jest.fn().mockRejectedValue(revoked) }),
      'ios',
    )

    await expect(provider.renew()).rejects.toMatchObject({ code: 'invalid_grant' })
  })

  it('gives an Android renewal time for the account sheet, which may come up', async () => {
    jest.useFakeTimers()
    try {
      const slow = new Promise((resolve) => setTimeout(() => resolve(success('id-late')), 30_000))
      const renewal = googleProviderFor({ webClientId: WEB, iosClientId: IOS }, sdk({ signIn: jest.fn().mockReturnValue(slow) }), 'android').renew()

      await jest.advanceTimersByTimeAsync(30_000)

      await expect(renewal).resolves.toEqual({ idToken: 'id-late' })
    } finally {
      jest.useRealTimers()
    }
  })
})

