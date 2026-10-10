import { redirectSystemPath } from './app/+native-intent'

describe('links into the app', () => {
  it('keep the sign-in’s return on the board’s route', () => {
    expect(
      redirectSystemPath({ path: 'de.hilling.taskfest.dev://oauthredirect?state=s&code=c', initial: false }),
    ).toBe('/')
  })

  it('leave every other link alone', () => {
    expect(redirectSystemPath({ path: '/somewhere', initial: true })).toBe('/somewhere')
  })
})
