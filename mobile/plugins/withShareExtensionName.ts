import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import configPlugins, { type ConfigPlugin } from 'expo/config-plugins.js'
import { withDisplayName } from '../src/shareExtension.ts'

/**
 * Gives the iOS share extension the app's name in the share sheet (#356), where `expo-sharing`'s
 * plugin gives it the target's, "expo-sharing-extension".
 *
 * It rewrites the Info.plist that plugin writes, so its change must run after that plugin's. A
 * plugin's changes to the native project run after those of every plugin applied after it, and
 * `app.config.ts` applies this one to the config it returns -- before Expo applies the `plugins`
 * listed there, `expo-sharing` among them.
 */
export const withShareExtensionName: ConfigPlugin<string> = (config, name) =>
  configPlugins.withDangerousMod(config, [
    'ios',
    async (config) => {
      const infoPlist = join(config.modRequest.platformProjectRoot, 'expo-sharing-extension', 'Info.plist')
      writeFileSync(infoPlist, withDisplayName(readFileSync(infoPlist, 'utf8'), name))
      return config
    },
  ])
