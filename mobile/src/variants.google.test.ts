import { googleUrlScheme, variantOf, variants } from './variants'

const WEB = '1234-web.apps.googleusercontent.com'
const QA_IOS = '1234-qa.apps.googleusercontent.com'
const PROD_IOS = '1234-prod.apps.googleusercontent.com'

describe('Google sign-in in the variants (#280)', () => {
  it('signs in qa and prod with Google once the build knows the client ids, each with its own iOS client', () => {
    const env = {
      TASKFEST_GOOGLE_WEB_CLIENT_ID: WEB,
      TASKFEST_QA_GOOGLE_IOS_CLIENT_ID: QA_IOS,
      TASKFEST_PROD_GOOGLE_IOS_CLIENT_ID: PROD_IOS,
    }

    expect(variantOf('qa', env).google).toEqual({ webClientId: WEB, iosClientId: QA_IOS })
    expect(variantOf('prod', env).google).toEqual({ webClientId: WEB, iosClientId: PROD_IOS })
  })

  it('has no Google sign-in where a client id is missing, or on dev', () => {
    expect(variantOf('prod', { TASKFEST_GOOGLE_WEB_CLIENT_ID: WEB }).google).toBeNull()
    expect(variantOf('prod', { TASKFEST_PROD_GOOGLE_IOS_CLIENT_ID: PROD_IOS }).google).toBeNull()
    expect(variantOf('dev', { TASKFEST_GOOGLE_WEB_CLIENT_ID: WEB }).google).toBeNull()
    expect(variants.prod.google).toBeNull()
  })

  it('keeps qa’s test accounts beside Google', () => {
    const qa = variantOf('qa', {
      TASKFEST_GOOGLE_WEB_CLIENT_ID: WEB,
      TASKFEST_QA_GOOGLE_IOS_CLIENT_ID: QA_IOS,
      TASKFEST_QA_COGNITO_ISSUER: 'https://cognito-idp.eu-central-1.amazonaws.com/pool',
      TASKFEST_QA_APP_CLIENT_ID: 'app-client',
    })

    expect(qa.google).not.toBeNull()
    expect(qa.signIn?.label).toBe('TaskFest test account')
  })

  it('returns to the app on iOS through the reversed iOS client id, the URL scheme Google’s SDK expects', () => {
    expect(googleUrlScheme({ webClientId: WEB, iosClientId: '1234-qa.apps.googleusercontent.com' })).toBe(
      'com.googleusercontent.apps.1234-qa',
    )
  })
})
