import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/context'

/** The file a preview shows: its name, its type and a link that opens it. */
export type PreviewedFile = {
  fileName: string
  contentType: string
  url: string
}

type FilePreviewProps = {
  file: PreviewedFile
  /**
   * A fresh link to the file, asked for when Download is pressed: the one the preview opened with
   * may have expired while it was open, as a board stays open for hours.
   */
  link: () => Promise<string>
  onClose: () => void
  /**
   * Whether to show a PDF inside the page. By default where the browser says it has a viewer and
   * the pointer is fine: phones' browsers that claim one show a PDF as a single, still page.
   */
  inlinePdf?: boolean
}

/** Whether this browser shows a PDF inside a page as a document can be read. */
function showsPdfInline() {
  return navigator.pdfViewerEnabled && !window.matchMedia?.('(pointer: coarse)').matches
}

/**
 * A file's large preview over the board (#586): a photo at most nearly the window's size, or a PDF
 * in the browser's own viewer, with Download and Close. A modal `<dialog>`, so the board behind it
 * is out of reach and the keyboard stays in it; Escape, and a click beside the file, close it too,
 * and the focus goes back to what had it. A PDF is always offered in a new tab as well -- the
 * only way to read it where the browser shows none inside the page, and the better one for a long
 * document; Escape does not reach the page while the viewer has the focus.
 *
 * Download fetches the file and saves it under its own name. A link to storage cannot simply carry
 * `download`, since browsers ignore that attribute on another origin's link; the bucket's CORS rule
 * lets the site GET what it uploaded. It fetches past the cache: the image above it was loaded
 * without CORS, and a cached answer without CORS headers would refuse the fetch.
 */
function FilePreview({ file, link, onClose, inlinePdf = showsPdfInline() }: Readonly<FilePreviewProps>) {
  const { messages } = useI18n()
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const close = useRef<HTMLButtonElement>(null)

  // Modal where the browser can (jsdom cannot), then the focus on Close; and back to what had it
  // before, once the preview goes.
  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const element = dialog.current
    if (element && !element.open) {
      if (typeof element.showModal === 'function') {
        element.showModal()
      } else {
        element.setAttribute('open', '')
      }
    }
    close.current?.focus()
    return () => opener?.focus()
  }, [])

  // Escape, which a modal dialog reports as a cancel and would act on by closing itself.
  useEffect(() => {
    const element = dialog.current
    const onCancel = (event: Event) => {
      event.preventDefault()
      onClose()
    }
    element?.addEventListener('cancel', onCancel)
    return () => element?.removeEventListener('cancel', onCancel)
  }, [onClose])

  const download = () => {
    if (saving) {
      return
    }
    setFailed(false)
    setSaving(true)
    link()
      .then((url) => save(url, file.fileName))
      .catch(() => setFailed(true))
      .finally(() => setSaving(false))
  }

  const isPdf = file.contentType === 'application/pdf'
  return (
    // The dialog fills the window and is the backdrop; its content stops the clicks that are not.
    <dialog
      ref={dialog}
      className="file-preview-backdrop"
      aria-label={file.fileName}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="file-preview">
        {!isPdf ? (
          <img className="file-preview-image" src={file.url} alt={file.fileName} />
        ) : inlinePdf ? (
          <iframe className="file-preview-document" src={file.url} title={file.fileName} />
        ) : (
          <p className="file-preview-name">
            <span aria-hidden="true">📄 </span>
            {file.fileName}
          </p>
        )}
        {failed ? (
          <p className="file-preview-failed" role="alert">
            {messages.attachments.downloadFailed(file.fileName)}
          </p>
        ) : null}
        <div className="file-preview-actions">
          {isPdf ? (
            <a className="button-quiet" href={file.url} target="_blank" rel="noopener noreferrer">
              {messages.attachments.openInNewTab}
            </a>
          ) : null}
          <button type="button" className="button-primary" onClick={download} disabled={saving}>
            {messages.attachments.download}
          </button>
          <button type="button" className="button-quiet" onClick={onClose} ref={close}>
            {messages.attachments.close}
          </button>
        </div>
      </div>
    </dialog>
  )
}

/** Fetches the file and hands it to the browser to save, under the name it was attached as. */
async function save(url: string, fileName: string): Promise<void> {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`storage answered ${response.status}`)
  }
  const href = URL.createObjectURL(await response.blob())
  try {
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = fileName
    anchor.click()
  } finally {
    // After the click has handed the file over; a later tick keeps Safari from losing it.
    setTimeout(() => URL.revokeObjectURL(href), 0)
  }
}

export default FilePreview
