import { googleProviderFor, type GoogleSdk } from './google'

const WEB = '1234-web.apps.googleusercontent.com'
const IOS = '1234-ios.apps.googleusercontent.com'

function sdk(overrides: Partial<GoogleSdk> = {}): GoogleSdk & { [K in keyof GoogleSdk]: jest.Mock } {
  return {
    configure: jest.fn(),
    presentExplicitSignIn: jest.fn(),
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

    await googleProviderFor({ webClientId: WEB, iosClientId: IOS }, google).signIn()

    expect(google.configure).toHaveBeenCalledWith({ webClientId: WEB, iosClientId: IOS })
  })

  it('hands back the ID token, or nothing when the user turned back', async () => {
    const google = sdk({
      presentExplicitSignIn: jest
        .fn()
        .mockResolvedValueOnce(success('id-1'))
        .mockResolvedValueOnce({ type: 'cancelled', data: null }),
    })
    const provider = googleProviderFor({ webClientId: WEB, iosClientId: IOS }, google)

    await expect(provider.signIn()).resolves.toEqual({ idToken: 'id-1' })
    await expect(provider.signIn()).resolves.toBeNull()
  })

  it('configures the SDK once', async () => {
    const google = sdk({ presentExplicitSignIn: jest.fn().mockResolvedValue(success('id')) })
    const provider = googleProviderFor({ webClientId: WEB, iosClientId: IOS }, google)

    await provider.signIn()
    await provider.signOut()

    expect(google.configure).toHaveBeenCalledTimes(1)
    expect(google.signOut).toHaveBeenCalled()
  })

})

