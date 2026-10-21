import configPlugins, { type ConfigPlugin } from 'expo/config-plugins.js'
import { withShareLabel as labelled } from '../src/shareLabel.ts'

/**
 * Gives the shares Android offers the app for their own label (#355), which the share sheet shows
 * beneath the app's name.
 *
 * It labels the intent filters `expo-sharing`'s plugin adds, so its change must run after that
 * plugin's -- which it does applied, like `withShareExtensionName`, to the config `app.config.ts`
 * returns.
 */
export const withShareLabel: ConfigPlugin<string> = (config, label) =>
  configPlugins.withAndroidManifest(config, (config) => {
    config.modResults = labelled(config.modResults, label)
    return config
  })
