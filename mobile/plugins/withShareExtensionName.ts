import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import configPlugins, { type ConfigPlugin } from 'expo/config-plugins.js'
import { withDisplayName, withFolderPerFile } from '../src/shareExtension.ts'

/**
 * Gives the iOS share extension its name in the share sheet (#356), where `expo-sharing`'s
 * plugin gives it the target's, "expo-sharing-extension"; and has it copy each shared file into a
 * folder of its own (`withFolderPerFile` says why).
 *
 * It rewrites the Info.plist and the code that plugin writes, so its change must run after that
 * plugin's. A
 * plugin's changes to the native project run after those of every plugin applied after it, and
 * `app.config.ts` applies this one to the config it returns -- before Expo applies the `plugins`
 * listed there, `expo-sharing` among them.
 */
export const withShareExtensionName: ConfigPlugin<string> = (config, name) =>
  configPlugins.withDangerousMod(config, [
    'ios',
    async (config) => {
      const extension = join(config.modRequest.platformProjectRoot, 'expo-sharing-extension')
      const infoPlist = join(extension, 'Info.plist')
      writeFileSync(infoPlist, withDisplayName(readFileSync(infoPlist, 'utf8'), name))
      const code = join(extension, 'ShareIntoViewController.swift')
      writeFileSync(code, withFolderPerFile(readFileSync(code, 'utf8')))
      return config
    },
  ])
