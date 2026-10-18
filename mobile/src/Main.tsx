import Constants from 'expo-constants'
import { Directory, File, Paths } from 'expo-file-system'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import * as ImagePicker from 'expo-image-picker'
import * as IntentLauncher from 'expo-intent-launcher'
import { getLocales } from 'expo-localization'
import * as Notifications from 'expo-notifications'
import * as SecureStore from 'expo-secure-store'
import * as WebBrowser from 'expo-web-browser'
import { Platform } from 'react-native'
import { GoogleOneTapSignIn } from 'react-native-nitro-google-signin'
import {
  announceAttachment,
  attachmentLink,
  confirmAttachment,
  createTask,
  deleteAccount,
  deleteTask,
  fetchMinimumAppVersion,
  fetchTasks,
  removeAttachment,
  restoreTask,
  updateTask,
} from './api'
import { documentsFor } from './documents'
import { pickFile, type PickedPhoto } from './pick'
import { makeThumbnail } from './thumbnails'
import { uploadFile, type UploadParts } from './upload'
import { googleProviderFor } from './google'
import { createKeptBoardStore } from './keptBoard'
import { createReminderScheduler, type NotificationsApi } from './notifications'
import { providerFor } from './provider'
import { createSessionStore } from './staySignedIn'
import { TaskFestApp, type Dependencies } from './TaskFestApp'
import { variantFromConfig } from './variants'
import { attachmentTypes, catalogues, chooseLanguage } from './web'

/** The variant this build was made as: `app.config.ts` put it into the app's configuration. */
const variant = variantFromConfig(Constants.expoConfig?.extra?.variant)

/** No provider at all, for a variant without sign-in: nothing to sign in with or renew. */
const noProvider: Dependencies['provider'] = {
  signIn: async () => null,
  refresh: () => Promise.reject(new Error('This build has no sign-in.')),
}

/**
 * This build's release, from `TASKFEST_VERSION` through app.config.ts. The release build sets it
 * from the tag (#276); every other build is 0.0.0.
 */
const appVersion = Constants.expoConfig?.version ?? '0.0.0'

/** The phone's language, chosen once: the app and the reminders' channel speak it. */
const language = chooseLanguage(null, getLocales().map((locale) => locale.languageTag))

// A reminder arriving while the app is open is shown as it would be outside it.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

/**
 * expo-notifications, adapted to what the reminders need. Written out rather than cast, so the
 * compiler checks every call against the library's own types after an SDK update.
 */
const notifications: NotificationsApi = {
  getPermissionsAsync: () => Notifications.getPermissionsAsync(),
  requestPermissionsAsync: () => Notifications.requestPermissionsAsync(),
  cancelAllScheduledNotificationsAsync: () => Notifications.cancelAllScheduledNotificationsAsync(),
  scheduleNotificationAsync: ({ content, trigger }) =>
    Notifications.scheduleNotificationAsync({
      content,
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: trigger.date, channelId: trigger.channelId },
    }),
  createChannel: async (id, name) => {
    await Notifications.setNotificationChannelAsync(id, { name, importance: Notifications.AndroidImportance.DEFAULT })
  },
}

/** Where Android keeps the files it opens (#274): the cache, emptied when the session ends. */
const documents = new Directory(Paths.cache, 'documents')

/** A photo as the image picker hands it over, or null when the user turned back. */
function photoOf(result: ImagePicker.ImagePickerResult): PickedPhoto | null {
  const asset = result.canceled ? undefined : result.assets[0]
  return asset
    ? {
        uri: asset.uri,
        fileName: asset.fileName ?? null,
        mimeType: asset.mimeType ?? null,
        fileSize: asset.fileSize ?? null,
        width: asset.width,
        height: asset.height,
      }
    : null
}

/**
 * An image, changed as `change` says, saved as a JPEG at this quality, with its size. The decoded
 * image is released straight after, not left to the garbage collector: a photo's is tens of megabytes.
 */
async function savedJpeg(
  uri: string,
  change: (context: ReturnType<typeof ImageManipulator.manipulate>) => ReturnType<typeof ImageManipulator.manipulate>,
  compress: number,
) {
  const context = change(ImageManipulator.manipulate(uri))
  const image = await context.renderAsync()
  try {
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress })
    return { uri: saved.uri, size: new File(saved.uri).size }
  } finally {
    image.release()
    context.release()
  }
}

/** The phone's side of uploading a file (#274): a PUT straight to storage, and a photo's thumbnail. */
const uploadParts: UploadParts = {
  put: async (uri, url, headers, onProgress) => {
    const result = await new File(uri).upload(url, {
      httpMethod: 'PUT',
      headers,
      onProgress: onProgress && ((progress) => onProgress(progress.totalBytes > 0 ? progress.bytesSent / progress.totalBytes : 0)),
    })
    if (result.status < 200 || result.status >= 300) {
      throw new Error(`Storage answered ${result.status}.`)
    }
  },
  thumbnail: (file) =>
    makeThumbnail(file, {
      dimensions: async (uri) => {
        const context = ImageManipulator.manipulate(uri)
        const image = await context.renderAsync()
        const measured = { width: image.width, height: image.height }
        image.release()
        context.release()
        return measured
      },
      render: (uri, crop, size) => savedJpeg(uri, (context) => context.crop(crop).resize(size), 0.8),
    }),
}

/** Android's flag letting the viewer read the one file it is handed. */
const FLAG_GRANT_READ_URI_PERMISSION = 1

const dependencies: Dependencies = {
  sessions: createSessionStore(SecureStore),
  provider: variant.signIn ? providerFor(variant.signIn, variant.scheme) : noProvider,
  google: variant.google ? googleProviderFor(variant.google, GoogleOneTapSignIn, Platform.OS) : undefined,
  // Every request names the app's release (#268).
  fetchTasks: (caller) => fetchTasks({ ...caller, appVersion }),
  changes: {
    create: (caller, input) => createTask({ ...caller, appVersion }, input),
    update: (caller, task) => updateTask({ ...caller, appVersion }, task),
    remove: (caller, task) => deleteTask({ ...caller, appVersion }, task),
    restore: (caller, task, today) => restoreTask({ ...caller, appVersion }, task, today),
  },
  attachments: {
    link: (caller, taskId, attachmentId, thumbnail) => attachmentLink({ ...caller, appVersion }, taskId, attachmentId, thumbnail),
    remove: (caller, taskId, attachmentId) => removeAttachment({ ...caller, appVersion }, taskId, attachmentId),
    upload: (caller, taskId, file, onProgress) =>
      uploadFile(
        { ...caller, appVersion },
        taskId,
        file,
        onProgress,
        { announce: announceAttachment, confirm: confirmAttachment },
        uploadParts,
      ),
  },
  pickFile: (source) =>
    pickFile(source, {
      cameraAllowed: async () => (await ImagePicker.requestCameraPermissionsAsync()).granted,
      camera: async () => photoOf(await ImagePicker.launchCameraAsync({ mediaTypes: ['images'] })),
      library: async () =>
        photoOf(
          await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            // A JPEG rather than an iPhone's HEIC where iOS can give one; pick.ts turns any HEIC left.
            preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
          }),
        ),
      files: async () => {
        const picked = await File.pickFileAsync({ mimeTypes: attachmentTypes })
        const file = picked.canceled ? null : picked.result
        return file ? { uri: file.uri, name: file.name, type: file.type, size: file.size } : null
      },
      sizeOf: (uri) => new File(uri).size,
      toJpeg: (uri) => savedJpeg(uri, (context) => context, 0.9),
      now: () => Date.now(),
    }),
  documents: documentsFor(Platform.OS, {
    openBrowser: (url) => WebBrowser.openBrowserAsync(url),
    download: async (url, fileName) => {
      if (!documents.exists) {
        documents.create()
      }
      return File.downloadFileAsync(url, new File(documents, fileName), { idempotent: true })
    },
    view: (contentUri, mimeType) =>
      IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        type: mimeType,
        flags: FLAG_GRANT_READ_URI_PERMISSION,
      }),
    forget: async () => {
      if (documents.exists) {
        documents.delete()
      }
    },
  }),
  deleteAccount: (caller) => deleteAccount({ ...caller, appVersion }),
  keptBoard: createKeptBoardStore(new File(Paths.cache, 'board.json')),
  reminders: createReminderScheduler(
    notifications,
    new File(Paths.document, 'reminders-offer-answered'),
    catalogues[language].reminders.channel,
  ),
  fetchMinimumAppVersion: () => fetchMinimumAppVersion(variant.apiBaseUrl, appVersion),
  appVersion,
  now: Date.now,
}

/**
 * The app's root, with the real keychain, provider and backend.
 *
 * One screen, so no router: Expo Router, tried first, took the sign-in's return link for a page
 * and mounted a second copy of the app while the first still waited for its tokens (#267).
 * Navigation comes back with the screens that need it.
 */
export default function Main() {
  return <TaskFestApp variant={variant} language={language} dependencies={dependencies} />
}
