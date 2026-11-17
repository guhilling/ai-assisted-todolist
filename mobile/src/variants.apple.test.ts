import { variantFromConfig, variantOf, variants } from './variants'

describe('Sign in with Apple in the variants (#281)', () => {
  it('offers Apple on qa and prod where the build says the App ID has it', () => {
    expect(variantOf('qa', { TASKFEST_QA_APPLE_SIGN_IN: 'true' }).apple).toBe(true)
    expect(variantOf('prod', { TASKFEST_PROD_APPLE_SIGN_IN: 'true' }).apple).toBe(true)
  })

  it('offers it nowhere else: not unless told, not for the other variant, never on dev', () => {
    expect(variants.qa.apple).toBeUndefined()
    expect(variants.prod.apple).toBeUndefined()
    expect(variantOf('prod', { TASKFEST_PROD_APPLE_SIGN_IN: 'false' }).apple).toBeUndefined()
    expect(variantOf('prod', { TASKFEST_QA_APPLE_SIGN_IN: 'true' }).apple).toBeUndefined()
    expect(variantOf('dev', { TASKFEST_QA_APPLE_SIGN_IN: 'true', TASKFEST_PROD_APPLE_SIGN_IN: 'true' }).apple).toBeUndefined()
  })

  it('keeps it when read back from the app’s configuration', () => {
    const prod = variantOf('prod', { TASKFEST_PROD_APPLE_SIGN_IN: 'true' })

    expect(variantFromConfig(prod).apple).toBe(true)
    expect(variantFromConfig(variants.prod).apple).toBeUndefined()
  })
})
