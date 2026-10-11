import * as AuthSession from 'expo-auth-session'
import { providerFor } from './provider'
import { REQUEST_MS, TimedOutError } from './timeLimit'
import type { SignIn } from './variants'

jest.mock('expo-auth-session', () => {
  const promptAsync = jest.fn()
  return {
    makeRedirectUri: jest.fn(({ scheme, path }) => `${scheme}://${path}`),
    fetchDiscoveryAsync: jest.fn(),
    exchangeCodeAsync: jest.fn(),
    refreshAsync: jest.fn(),
    AuthRequest: jest.fn().mockImplementation(() => ({ promptAsync, codeVerifier: 'verifier' })),
    __promptAsync: promptAsync,
  }
})

const mocked = AuthSession as unknown as {
  fetchDiscoveryAsync: jest.Mock
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

const discovered = { tokenEndpoint: 'https://idp/token' }
const never = () => new Promise(() => undefined)

describe('the provider, when it gets no answer (#311)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
  })
  afterEach(() => jest.useRealTimers())

  it('gives up on renewing the tokens after ten seconds', async () => {
    mocked.fetchDiscoveryAsync.mockResolvedValue(discovered)
    mocked.refreshAsync.mockImplementation(never)
    const renewing = providerFor(keycloak, 'scheme').refresh('refresh')
    const failed = expect(renewing).rejects.toBeInstanceOf(TimedOutError)

    await jest.advanceTimersByTimeAsync(REQUEST_MS)

    await failed
  })

  it('gives up on the discovery document after ten seconds, and asks for it anew next time', async () => {
    mocked.fetchDiscoveryAsync.mockImplementationOnce(never).mockResolvedValue(discovered)
    mocked.refreshAsync.mockResolvedValue({ idToken: 'id', refreshToken: 'refresh' })
    const provider = providerFor(keycloak, 'scheme')
    const first = expect(provider.refresh('refresh')).rejects.toBeInstanceOf(TimedOutError)

    await jest.advanceTimersByTimeAsync(REQUEST_MS)
    await first

    await expect(provider.refresh('refresh')).resolves.toEqual({ idToken: 'id', refreshToken: 'refresh' })
    expect(mocked.fetchDiscoveryAsync).toHaveBeenCalledTimes(2)
  })

  it('gives up on exchanging the code after ten seconds', async () => {
    mocked.fetchDiscoveryAsync.mockResolvedValue(discovered)
    mocked.__promptAsync.mockResolvedValue({ type: 'success', params: { code: 'the-code' } })
    mocked.exchangeCodeAsync.mockImplementation(never)
    const signingIn = providerFor(keycloak, 'scheme').signIn()
    const failed = expect(signingIn).rejects.toBeInstanceOf(TimedOutError)

    await jest.advanceTimersByTimeAsync(REQUEST_MS)

    await failed
  })

  it('leaves the user all the time they need in the browser', async () => {
    mocked.fetchDiscoveryAsync.mockResolvedValue(discovered)
    mocked.__promptAsync.mockImplementation(never)
    let settled = false
    void providerFor(keycloak, 'scheme')
      .signIn()
      .finally(() => (settled = true))

    await jest.advanceTimersByTimeAsync(10 * REQUEST_MS)

    expect(settled).toBe(false)
  })
})
