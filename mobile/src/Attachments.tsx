import { useEffect, useState } from 'react'
import { Image, Modal, Pressable, Text, View } from 'react-native'
import { isImage, isImageType } from './files'
import type { PickSource } from './pick'
import type { PickedFile } from './upload'
import type { Styles } from './styles'
import { attachmentLimits, type Attachment, type Messages, type Task } from './web'

/**
 * A task's files in the app (#274), as the website shows them (`frontend/src/components/AttachmentList.tsx`):
 * an image as a small preview, a PDF by its name, each opening when tapped -- an image in the app's
 * own viewer, a PDF in the phone's.
 */

/**
 * A link that shows a file, or its preview thumbnail. Expected to keep its identity across renders,
 * so a preview asks once rather than on every render; whoever passes it keeps the links fresh.
 */
export type FileLinkSource = (taskId: Task['id'], attachmentId: Attachment['id'], thumbnail: boolean) => Promise<string>

/** A task's files on its row, each opening when tapped. Nothing when it has none. */
export function FileStrip({
  task,
  link,
  messages,
  styles,
  onOpen,
}: {
  task: Task
  link: FileLinkSource
  messages: Messages
  styles: Styles
  onOpen: (attachment: Attachment) => void
}) {
  const attachments = task.attachments ?? []
  if (attachments.length === 0) {
    return null
  }
  return (
    <View style={styles.fileStrip}>
      {attachments.map((attachment) => (
        <Pressable
          key={attachment.id}
          accessibilityRole="button"
          accessibilityLabel={messages.attachments.open(attachment.fileName)}
          hitSlop={4}
          onPress={() => onOpen(attachment)}
        >
          {isImage(attachment) ? (
            <Preview taskId={task.id} attachment={attachment} link={link} styles={styles} />
          ) : (
            <View style={styles.fileName}>
              <Text aria-hidden>📄</Text>
              <Text style={styles.muted} numberOfLines={1}>
                {attachment.fileName}
              </Text>
            </View>
          )}
        </Pressable>
      ))}
    </View>
  )
}

/**
 * An image, shown once its link has arrived; until then, a box of the same size. Its thumbnail when
 * it has one, and the file itself when it has none or the thumbnail cannot be had -- a database
 * restored from a snapshot can name a thumbnail that is no longer there.
 */
function Preview({
  taskId,
  attachment,
  link,
  styles,
}: {
  taskId: Task['id']
  attachment: Attachment
  link: FileLinkSource
  styles: Styles
}) {
  const [source, setSource] = useState<string | null>(null)
  const [thumbnail, setThumbnail] = useState(attachment.thumbnail)
  const attachmentId = attachment.id

  useEffect(() => {
    let current = true
    link(taskId, attachmentId, thumbnail)
      .then((url) => {
        if (current) {
          setSource(url)
        }
      })
      // No thumbnail is the file instead; no preview at all is not worth a notice, as the file
      // still opens from the box.
      .catch(() => {
        if (current && thumbnail) {
          setThumbnail(false)
        }
      })
    return () => {
      current = false
    }
  }, [link, taskId, attachmentId, thumbnail])

  return source ? (
    <Image
      testID={`preview-${attachmentId}`}
      source={{ uri: source }}
      style={styles.preview}
      onError={thumbnail ? () => setThumbnail(false) : undefined}
    />
  ) : (
    <View style={[styles.preview, styles.previewLoading]} />
  )
}

/** An image opened from its task, over everything, at the size the screen allows. */
export function FileViewer({
  file,
  messages,
  styles,
  onClose,
}: {
  /** The image shown; none while nothing is. */
  file: { url: string; fileName: string } | null
  messages: Messages
  styles: Styles
  onClose: () => void
}) {
  return (
    <Modal visible={file !== null} animationType="fade" onRequestClose={onClose}>
      {file ? (
        <View testID="file-viewer" style={styles.viewer}>
          <Image
            testID="viewed-image"
            accessibilityLabel={file.fileName}
            source={{ uri: file.url }}
            style={styles.viewedImage}
            resizeMode="contain"
          />
          <Pressable accessibilityRole="button" style={styles.quietButton} onPress={onClose}>
            <Text style={styles.quietButtonText}>{messages.attachments.close}</Text>
          </Pressable>
        </View>
      ) : null}
    </Modal>
  )
}

/**
 * A task's files in its editor, each removable while the task is open; a completed task's are not,
 * as on the website. They open from the board: a viewer over the editor's sheet is more than iOS
 * presents. A removed file has no undo.
 */
export function EditorFiles({
  attachments,
  removable,
  busy,
  messages,
  styles,
  onRemove,
}: {
  attachments: Attachment[]
  removable: boolean
  /** Whether a change to the task is on its way: removing waits for it. */
  busy: boolean
  messages: Messages
  styles: Styles
  onRemove: (attachment: Attachment) => void
}) {
  return (
    <>
      {attachments.map((attachment) => (
        <View key={attachment.id} style={styles.editorFile}>
          <Text aria-hidden>{isImage(attachment) ? '🖼' : '📄'}</Text>
          <Text style={styles.description} numberOfLines={1}>
            {attachment.fileName}
          </Text>
          {removable ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={messages.attachments.remove(attachment.fileName)}
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              hitSlop={8}
              style={[styles.quietButton, busy && styles.disabled]}
              onPress={() => onRemove(attachment)}
            >
              <Text style={styles.dangerText}>×</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
    </>
  )
}

/**
 * Files picked while adding a task, held until it exists (#274), each of which may go again first.
 */
export function PendingFiles({
  files,
  disabled,
  messages,
  styles,
  onUnpick,
}: {
  files: PickedFile[]
  /** While the task is being added, and its files with it, none may go. */
  disabled: boolean
  messages: Messages
  styles: Styles
  onUnpick: (file: PickedFile) => void
}) {
  return files.map((file) => (
    <View key={file.uri} style={styles.editorFile}>
      <Text aria-hidden>{isImageType(file.type) ? '🖼' : '📄'}</Text>
      <Text style={styles.description} numberOfLines={1}>
        {file.name}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={messages.attachments.remove(file.name)}
        accessibilityState={{ disabled }}
        disabled={disabled}
        hitSlop={8}
        style={[styles.quietButton, disabled && styles.disabled]}
        onPress={() => onUnpick(file)}
      >
        <Text style={styles.dangerText}>×</Text>
      </Pressable>
    </View>
  ))
}

/**
 * The ways to attach a file (#274) -- the camera, the photo library, the files -- with the
 * website's limits, or why there is none: the task holds as many files as it can. While a file
 * uploads, how far it has got.
 */
export function AttachFiles({
  count,
  uploading,
  disabled,
  messages,
  styles,
  onAttach,
}: {
  /** How many files the task holds, or will hold once added. */
  count: number
  uploading: { name: string; fraction: number } | null
  disabled: boolean
  messages: Messages
  styles: Styles
  onAttach: (source: PickSource) => void
}) {
  const { maxSizeBytes, perTask, perUser } = attachmentLimits
  const way = (source: PickSource, label: string) => (
    <Pressable
      key={source}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      style={[styles.chip, disabled && styles.disabled]}
      onPress={() => onAttach(source)}
    >
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
  )
  return (
    <>
      {uploading ? (
        <View style={styles.editorFile}>
          <Text style={styles.description}>{messages.attachments.uploading(uploading.name)}</Text>
          <Text style={styles.muted}>{messages.attachments.progress(Math.round(uploading.fraction * 100))}</Text>
        </View>
      ) : null}
      {count >= perTask ? (
        <Text style={styles.muted}>{messages.attachments.full(perTask)}</Text>
      ) : (
        <>
          <View style={styles.chips}>
            {way('camera', messages.attachments.takePhoto)}
            {way('library', messages.attachments.choosePhoto)}
            {way('files', messages.attachments.chooseFile)}
          </View>
          <Text style={styles.muted}>{messages.attachments.limits(maxSizeBytes / (1024 * 1024), perTask, perUser)}</Text>
        </>
      )}
    </>
  )
}
