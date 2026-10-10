import { variantOf, variants } from './variants'

describe('the app’s variants', () => {
  it('installs side by side under the decided bundle ids', () => {
    expect(variants.prod.bundleId).toBe('de.hilling.taskfest')
    expect(variants.qa.bundleId).toBe('de.hilling.taskfest.qa')
    expect(variants.dev.bundleId).toBe('de.hilling.taskfest.dev')
  })

  it('each opens with its own scheme, so a sign-in returns to the variant that started it', () => {
    expect(new Set(Object.values(variants).map((variant) => variant.scheme)).size).toBe(3)
    expect(variants.dev.scheme).toBe('de.hilling.taskfest.dev')
  })

  it('talks to the environment of its name', () => {
    expect(variants.prod.apiBaseUrl).toBe('https://taskfest.cloud.hilling.de')
    expect(variants.qa.apiBaseUrl).toBe('https://taskfest-qa.cloud.hilling.de')
    expect(variants.dev.apiBaseUrl).toBe('http://localhost:3000')
  })

  it('signs in on dev with the local Keycloak’s app client', () => {
    expect(variants.dev.signIn).toEqual({
      label: 'Keycloak',
      issuer: 'http://localhost:8082/realms/taskfest',
      clientId: 'taskfest-app',
      scopes: ['openid', 'email', 'profile', 'offline_access'],
    })
  })

  it('has no sign-in on prod until Google’s comes (#280)', () => {
    expect(variants.prod.signIn).toBeNull()
  })

  it('takes qa’s test accounts from the build, where they are known', () => {
    expect(variantOf('qa', {}).signIn).toBeNull()
    expect(
      variantOf('qa', {
        TASKFEST_QA_COGNITO_ISSUER: 'https://cognito-idp.eu-central-1.amazonaws.com/pool',
        TASKFEST_QA_APP_CLIENT_ID: 'app-client',
      }).signIn,
    ).toEqual({
      label: 'TaskFest test account',
      issuer: 'https://cognito-idp.eu-central-1.amazonaws.com/pool',
      clientId: 'app-client',
      scopes: ['openid', 'email', 'profile'],
    })
  })

  it('is dev when nothing says otherwise, and refuses a name it does not know', () => {
    expect(variantOf(undefined, {}).bundleId).toBe('de.hilling.taskfest.dev')
    expect(() => variantOf('staging', {})).toThrow('staging')
  })
})
