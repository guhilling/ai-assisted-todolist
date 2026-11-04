import fs from 'node:fs'
import path from 'node:path'
import configPlugins, { type ConfigPlugin } from 'expo/config-plugins.js'
import { declareTimeZoneReceiver, RECEIVER } from '../src/timeZoneReceiver.ts'

/**
 * Moves the floating reminders with the phone's time zone on Android (#479): declares the receiver
 * in the manifest and copies its Kotlin class, `plugins/android/TimeZoneChangedReceiver.kt`, into the
 * generated `android/` project, which is never committed (doc/decisions/mobile-app.md).
 */
export const withTimeZoneReceiver: ConfigPlugin = (config) => {
  config = configPlugins.withAndroidManifest(config, (config) => {
    config.modResults = declareTimeZoneReceiver(config.modResults)
    return config
  })
  return configPlugins.withDangerousMod(config, [
    'android',
    (config) => {
      const source = path.join(config.modRequest.projectRoot, 'plugins', 'android', 'TimeZoneChangedReceiver.kt')
      const target = path.join(
        config.modRequest.platformProjectRoot,
        'app/src/main/java',
        ...RECEIVER.split('.').slice(0, -1),
        'TimeZoneChangedReceiver.kt',
      )
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(source, target)
      return config
    },
  ])
}
