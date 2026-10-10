// Metro, told about the one folder outside the app it may bundle from (#267).
//
// src/web.ts imports the website's generated types and validators, texts and date rules from
// ../frontend/src. Metro watches only the project by default, so that folder is added; and a
// module those files need (Babel's runtime helpers) is looked up in the app's node_modules, since
// frontend/ need not have its own installed for the app to build.
const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)
config.watchFolders = [path.resolve(__dirname, '../frontend/src')]
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')]

module.exports = config
