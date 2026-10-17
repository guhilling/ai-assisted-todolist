import { variantFromConfig, variants } from './variants'

describe('reading the variant back from the app’s configuration', () => {
  it('takes an empty object for no provider: Expo’s config loader turns a null into one', () => {
    const fromConfig = variantFromConfig({ ...variants.prod, signIn: {}, google: {} })

    expect(fromConfig.signIn).toBeNull()
    expect(fromConfig.google).toBeNull()
  })

  it('keeps the providers a build has', () => {
    const google = { webClientId: 'web', iosClientId: 'ios' }

    expect(variantFromConfig({ ...variants.dev, google })).toEqual({ ...variants.dev, google })
  })
})
