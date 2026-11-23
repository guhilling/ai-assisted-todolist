import type { ConfigContext, ExpoConfig } from 'expo/config'
import appConfig from '../app.config'

// The plugins are written for Expo's config loader, which Jest is not; what they add is tested in
// their own modules.
jest.mock('../plugins/withShareExtensionName.ts', () => ({ withShareExtensionName: (config: ExpoConfig) => config }))
jest.mock('../plugins/withShareLabel.ts', () => ({ withShareLabel: (config: ExpoConfig) => config }))
jest.mock('../plugins/withTimeZoneReceiver.ts', () => ({ withTimeZoneReceiver: (config: ExpoConfig) => config }))
jest.mock('../plugins/withoutAppleSignIn.ts', () => ({ withoutAppleSignIn: (config: ExpoConfig) => config }))

describe('the app’s Android permissions', () => {
  it('include exact alarms, which the user may allow for reminders on time (#665)', () => {
    const config = appConfig({ config: {} } as ConfigContext)

    expect(config.android?.permissions).toContain('android.permission.SCHEDULE_EXACT_ALARM')
  })
})
