import { SignedOut, type AuthProvidersResponse } from 'frontend'

function providers(list: AuthProvidersResponse['providers']): AuthProvidersResponse {
  return { enabled: true, providers: list }
}

const google = {
  id: 'google',
  label: 'Google',
  available: true,
  loginUrl: '/api/auth/login',
  issuer: 'https://accounts.google.com',
}

const keycloak = {
  id: 'keycloak',
  label: 'Keycloak',
  available: true,
  loginUrl: '/api/auth/login/keycloak',
  issuer: 'http://localhost:8081/realms/todo',
}

/** The normal render: one configured provider, so a single button and no chooser. */
export function OneProvider() {
  return <SignedOut providers={providers([google])} apiBaseUrl="" />
}

export function TwoProviders() {
  return <SignedOut providers={providers([google, keycloak])} apiBaseUrl="" />
}

/**
 * A provider that is configured but has no credentials is reported unavailable, and is not
 * offered -- a card for it would be a dead end.
 */
export function NothingConfigured() {
  return (
    <SignedOut
      providers={providers([{ ...keycloak, available: false, loginUrl: null }])}
      apiBaseUrl=""
    />
  )
}
