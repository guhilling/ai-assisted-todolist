import * as AuthSession from 'expo-auth-session'
import { providerFor } from './provider'
import type { SignIn } from './variants'

jest.mock('expo-auth-session', () => {
  const promptAsync = jest.fn()
  return {
    makeRedirectUri: jest.fn(({ scheme, path }) => `${scheme}://${path}`),
    fetchDiscoveryAsync: jest.fn().mockResolvedValue({ tokenEndpoint: 'https://idp/token' }),
    exchangeCodeAsync: jest.fn(),
    refreshAsync: jest.fn(),
    AuthRequest: jest.fn().mockImplementation(() => ({ promptAsync, codeVerifier: 'verifier' })),
    __promptAsync: promptAsync,
  }
})

const mocked = AuthSession as unknown as {
  AuthRequest: jest.Mock
  exchangeCodeAsync: jest.Mock
  refreshAsync: jest.Mock
  __promptAsync: jest.Mock
}

const keycloak: SignIn = {
  label: 'Keycloak',
  issuer: 'http://localhost:8082/realms/taskfest',
  clientId: 'taskfest-app',
  scopes: ['openid', 'offline_access'],
}

describe('signing in with a provider', () => {
  beforeEach(() => jest.clearAllMocks())

  it('asks for a code with PKCE, returning to the variant’s own scheme', async () => {
    mocked.__promptAsync.mockResolvedValue({ type: 'success', params: { code: 'the-code' } })
    mocked.exchangeCodeAsync.mockResolvedValue({ idToken: 'id', refreshToken: 'refresh' })

    await providerFor(keycloak, 'de.hilling.taskfest.dev').signIn()

    expect(mocked.AuthRequest).toHaveBeenCalledWith({
      clientId: 'taskfest-app',
      scopes: ['openid', 'offline_access'],
      redirectUri: 'de.hilling.taskfest.dev://oauthredirect',
      usePKCE: true,
    })
  })

  it('exchanges the code with its verifier and keeps the ID and refresh tokens', async () => {
    mocked.__promptAsync.mockResolvedValue({ type: 'success', params: { code: 'the-code' } })
    mocked.exchangeCodeAsync.mockResolvedValue({ idToken: 'id', refreshToken: 'refresh', accessToken: 'unused' })

    await expect(providerFor(keycloak, 'scheme').signIn()).resolves.toEqual({ idToken: 'id', refreshToken: 'refresh' })
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

  it('renews with the refresh token', async () => {
    mocked.refreshAsync.mockResolvedValue({ idToken: 'id-2', refreshToken: 'refresh-2' })

    await expect(providerFor(keycloak, 'scheme').refresh('refresh-1')).resolves.toEqual({
      idToken: 'id-2',
      refreshToken: 'refresh-2',
    })
    expect(mocked.refreshAsync).toHaveBeenCalledWith(
      { clientId: 'taskfest-app', refreshToken: 'refresh-1' },
      { tokenEndpoint: 'https://idp/token' },
    )
  })
})
