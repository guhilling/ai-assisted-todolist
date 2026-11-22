import * as AuthSession from 'expo-auth-session'
import { providerFor } from './provider'
import type { SignIn } from './variants'

jest.mock('expo-auth-session', () => {
  const promptAsync = jest.fn()
  return {
    makeRedirectUri: jest.fn(({ scheme, path }) => `${scheme}://${path}`),
    fetchDiscoveryAsync: jest.fn().mockResolvedValue({ tokenEndpoint: 'https://idp/token' }),
    exchangeCodeAsync: jest.fn(),
    AuthRequest: jest.fn().mockImplementation(() => ({ promptAsync, codeVerifier: 'verifier' })),
    __promptAsync: promptAsync,
  }
})

const mocked = AuthSession as unknown as {
  AuthRequest: jest.Mock
  exchangeCodeAsync: jest.Mock
  __promptAsync: jest.Mock
}

const keycloak: SignIn = {
  label: 'Keycloak',
  issuer: 'http://localhost:8082/realms/taskfest',
  clientId: 'taskfest-app',
  scopes: ['openid', 'email'],
}

describe('signing in with a provider', () => {
  beforeEach(() => jest.clearAllMocks())

  it('asks for a code with PKCE, returning to the variant’s own scheme', async () => {
    mocked.__promptAsync.mockResolvedValue({ type: 'success', params: { code: 'the-code' } })
    mocked.exchangeCodeAsync.mockResolvedValue({ idToken: 'id' })

    await providerFor(keycloak, 'de.hilling.taskfest.dev').signIn()

    expect(mocked.AuthRequest).toHaveBeenCalledWith({
      clientId: 'taskfest-app',
      scopes: ['openid', 'email'],
      redirectUri: 'de.hilling.taskfest.dev://oauthredirect',
      usePKCE: true,
    })
  })

  it('exchanges the code with its verifier and keeps the ID token alone', async () => {
    mocked.__promptAsync.mockResolvedValue({ type: 'success', params: { code: 'the-code' } })
    mocked.exchangeCodeAsync.mockResolvedValue({ idToken: 'id', refreshToken: 'unused', accessToken: 'unused' })

    await expect(providerFor(keycloak, 'scheme').signIn()).resolves.toEqual({ idToken: 'id' })
    expect(mocked.exchangeCodeAsync).toHaveBeenCalledWith(
      { clientId: 'taskfest-app', code: 'the-code', redirectUri: 'scheme://oauthredirect', extraParams: { code_verifier: 'verifier' } },
      { tokenEndpoint: 'https://idp/token' },
    )
  })

  it('has nothing when the user turned back', async () => {
    mocked.__promptAsync.mockResolvedValue({ type: 'cancel' })

    await expect(providerFor(keycloak, 'scheme').signIn()).resolves.toBeNull()
    expect(mocked.exchangeCodeAsync).not.toHaveBeenCalled()
  })

  it('reports an error the provider sent back, rather than taking it for turning back', async () => {
    mocked.__promptAsync.mockResolvedValue({ type: 'error', error: new Error('invalid_scope'), params: {} })

    await expect(providerFor(keycloak, 'scheme').signIn()).rejects.toThrow('invalid_scope')
  })

  it('asks for the provider’s discovery document once, not on every sign-in', async () => {
    mocked.__promptAsync.mockResolvedValue({ type: 'cancel' })
    const provider = providerFor(keycloak, 'scheme')

    await provider.signIn()
    await provider.signIn()

    expect(AuthSession.fetchDiscoveryAsync).toHaveBeenCalledTimes(1)
  })

})
