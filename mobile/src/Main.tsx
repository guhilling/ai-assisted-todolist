import Constants from 'expo-constants'
import { Directory, File, Paths } from 'expo-file-system'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import * as IntentLauncher from 'expo-intent-launcher'
import { getLocales } from 'expo-localization'
import * as Notifications from 'expo-notifications'
import * as SecureStore from 'expo-secure-store'
import * as Sharing from 'expo-sharing'
import * as WebBrowser from 'expo-web-browser'
import { Platform } from 'react-native'
import { GoogleOneTapSignIn } from 'react-native-nitro-google-signin'
import {
  addDraft,
  announceAttachment,
  attachmentLink,
  confirmAttachment,
  createTask,
  deleteAccount,
  deleteTask,
  discardDraft,
  fetchMinimumAppVersion,
  fetchTasks,
  removeAttachment,
  addLink,
  restoreTask,
  startDraft,
  updateTask,
} from './api'
import { fileFlag } from './fileFlag'
import { documentsFor } from './documents'
import { sharesFrom } from './incoming'
import { pickFile, type PickedPhoto } from './pick'
import { makeThumbnail } from './thumbnails'
import { uploadFile, type UploadParts } from './upload'
import { googleProviderFor } from './google'
import { createKeptBoardStore } from './keptBoard'
import { createPreviewStore, type PreviewFolder } from './previews'
import { createReminderScheduler, type NotificationsApi } from './notifications'
import { providerFor } from './provider'
import { createSessionStore } from './staySignedIn'
import { TaskFestApp, type Dependencies } from './TaskFestApp'
import { transferMs, withinLimit } from './timeLimit'
import { variantFromConfig } from './variants'
import { attachmentLimits, attachmentTypes, catalogues, chooseLanguage } from './web'

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

/**
 * Where the app keeps its copies of the files shared into it (#355), each under a name of its own.
 * Emptied when the first share is taken, of copies a run left behind that ended before their form
 * was closed -- then, rather than while the app starts.
 */
const sharedFiles = new Directory(Paths.cache, 'shared')

/**
 * Where the files' previews are kept (#397): the cache, beside the kept board -- a copy of what the
 * backend holds, not worth a backup, and the platform's sandbox keeps it from other apps.
 */
const previewFiles = new Directory(Paths.cache, 'previews')

/** The previews' folder, on the phone (`previews.ts` says how a download lands in it). */
const previewFolder: PreviewFolder = {
  find: (name) => {
    const file = new File(previewFiles, name)
    return file.exists ? file.uri : null
  },
  download: async (url, name) => {
    if (!previewFiles.exists) {
      previewFiles.create({ intermediates: true, idempotent: true })
    }
    // Within the time the largest file the backend takes may need, aborted after it (#432).
    await withinLimit(
      (signal) => File.downloadFileAsync(url, new File(previewFiles, name), { idempotent: true, signal }),
      transferMs(attachmentLimits.maxSizeBytes),
    )
  },
  move: (from, to) => {
    const kept = new File(previewFiles, to)
    if (kept.exists) {
      kept.delete()
    }
    new File(previewFiles, from).move(kept)
    return kept.uri
  },
  names: () => (previewFiles.exists ? previewFiles.list().map((entry) => entry.name) : []),
  remove: (name) => {
    const file = new File(previewFiles, name)
    if (file.exists) {
      file.delete()
    }
  },
  clear: () => {
    if (previewFiles.exists) {
      previewFiles.delete()
    }
  },
}
let sharedCopies = 0

/** Copies of shared files a run left behind, let go before the first share of this one is taken. */
function forgetLeftShares() {
  try {
    if (sharedCopies === 0 && sharedFiles.exists) {
      sharedFiles.delete()
    }
  } catch (failure) {
    console.warn('The shared files left behind could not be forgotten', failure)
  }
}

/** Lets a copy of a shared file go, if it is still there. */
function discardCopy(uri: string) {
  const copy = new File(uri)
  if (copy.exists) {
    copy.delete()
  }
}

/**
 * Lets a picked file go (#432), or a thumbnail or JPEG made of one -- only from the app's cache,
 * where the pickers and the image manipulator put their copies: a file anywhere else is not the
 * app's to delete.
 */
function discardPicked(uri: string) {
  if (!uri.startsWith(Paths.cache.uri)) {
    return
  }
  try {
    discardCopy(uri)
  } catch (failure) {
    console.warn('A picked file could not be let go', failure)
  }
}

/**
 * Lets a shared file go once read, if it is the one the iOS share extension left in the App Group's
 * container (#356): the extension copies every file there, and nothing else would delete it -- the
 * folder of its own it was copied into as well (`withFolderPerFile`). Any other -- Android's, which
 * are the sending app's -- stays.
 */
function releaseShared(uri: string) {
  const container = Object.values(Paths.appleSharedContainers).find((each) => uri.startsWith(each.uri))
  if (!container) {
    return
  }
  try {
    const folder = new File(uri).parentDirectory
    if (folder.uri.replace(/\/$/, '') !== container.uri.replace(/\/$/, '') && folder.exists) {
      folder.delete()
    } else {
      discardCopy(uri)
    }
  } catch (failure) {
    console.warn('A shared file could not be let go', failure)
  }
}

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
    const file = new File(uri)
    // Within the time a file of its size may need, and aborted after it (#432): a PUT that hangs
    // would leave the upload shown, and the foreground start held, for the rest of the run.
    const result = await withinLimit(
      (signal) =>
        file.upload(url, {
          httpMethod: 'PUT',
          headers,
          onProgress: onProgress && ((progress) => onProgress(progress.totalBytes > 0 ? progress.bytesSent / progress.totalBytes : 0)),
          signal,
        }),
      transferMs(file.size),
    )
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
  discard: discardPicked,
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
    // The add form's files upload to a draft while it is open (#381).
    drafts: {
      start: (caller) => startDraft({ ...caller, appVersion }),
      add: (caller, draftId, input) => addDraft({ ...caller, appVersion }, draftId, input),
      discard: (caller, draftId) => discardDraft({ ...caller, appVersion }, draftId),
    },
  },
  attachments: {
    link: (caller, taskId, attachmentId, thumbnail) => attachmentLink({ ...caller, appVersion }, taskId, attachmentId, thumbnail),
    remove: (caller, taskId, attachmentId) => removeAttachment({ ...caller, appVersion }, taskId, attachmentId),
    addLink: (caller, taskId, link) => addLink({ ...caller, appVersion }, taskId, link),
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
      // expo-document-picker rather than expo-file-system's own picker, whose File is named after
      // Android's content URI -- "image:1000000018" -- where this gives the name the user sees.
      files: async () => {
        const picked = await DocumentPicker.getDocumentAsync({ type: attachmentTypes, copyToCacheDirectory: true })
        const file = picked.canceled ? undefined : picked.assets[0]
        return file ? { uri: file.uri, name: file.name, type: file.mimeType ?? null, size: file.size ?? null } : null
      },
      sizeOf: (uri) => new File(uri).size,
      toJpeg: (uri) => savedJpeg(uri, (context) => context, 0.9),
      discard: discardPicked,
      now: () => Date.now(),
    }),
  forgetPicked: async (files) => files.forEach((file) => discardPicked(file.uri)),
  documents: documentsFor(Platform.OS, {
    openBrowser: (url) => WebBrowser.openBrowserAsync(url),
    download: async (url, fileName) => {
      if (!documents.exists) {
        documents.create()
      }
      // As a preview's: within the largest file's time, and aborted after it (#432), so a download
      // that hangs does not keep every other file from opening for the rest of the run.
      return withinLimit(
        (signal) => File.downloadFileAsync(url, new File(documents, fileName), { idempotent: true, signal }),
        transferMs(attachmentLimits.maxSizeBytes),
      )
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
    discard: async (fileName) => {
      const copy = new File(documents, fileName)
      if (copy.exists) {
        copy.delete()
      }
    },
  }),
  deleteAccount: (caller) => deleteAccount({ ...caller, appVersion }),
  keptBoard: createKeptBoardStore(new File(Paths.cache, 'board.json')),
  previews: createPreviewStore(previewFolder),
  legend: fileFlag(new File(Paths.document, 'colours-explained'), 'explained'),
  // Only the raw share is read, never "resolved": incoming.ts says why. It stays with expo-sharing
  // until its form opens (#432).
  incoming: {
    ...sharesFrom(
      { read: () => Sharing.getSharedPayloads(), clear: () => Sharing.clearSharedPayloads() },
      {
        describe: (uri) => {
          const file = new File(uri)
          return { name: file.name, type: file.type || null, size: file.size || null }
        },
        copy: async (uri, name) => {
          if (!sharedFiles.exists) {
            sharedFiles.create()
          }
          sharedCopies += 1
          const copy = new File(sharedFiles, `${sharedCopies}-${name}`)
          await new File(uri).copy(copy)
          return { uri: copy.uri, size: copy.size }
        },
        toJpeg: (uri) => savedJpeg(uri, (context) => context, 0.9),
        discard: discardCopy,
        release: releaseShared,
      },
      forgetLeftShares,
    ),
    forget: async (files) => files.forEach((file) => discardCopy(file.uri)),
  },
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
