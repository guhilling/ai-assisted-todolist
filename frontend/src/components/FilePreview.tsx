import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/context'

/** The file a preview shows: its name, its type and a link that opens it. */
export type PreviewedFile = {
  fileName: string
  contentType: string
  url: string
}

type FilePreviewProps = {
  file: PreviewedFile
  onClose: () => void
  /**
   * Whether this browser shows a PDF inside the page. Desktop browsers do; phones' mostly do not,
   * and say so through `navigator.pdfViewerEnabled`, which is what decides when this is left out.
   */
  inlinePdf?: boolean
}

/**
 * A file's large preview over the board (#586): a photo at most nearly the window's size, or a PDF
 * in the browser's own viewer, with Download and Close. Escape, and a click beside the file, close
 * it too. Where the browser cannot show a PDF inside the page, the preview offers to open it in a
 * new tab instead, as the board did before there was a preview.
 *
 * Download fetches the file and saves it under its own name. A link to storage cannot simply carry
 * `download`, since browsers ignore that attribute on another origin's link; the bucket's CORS rule
 * already lets the site GET what it uploaded.
 */
function FilePreview({ file, onClose, inlinePdf = navigator.pdfViewerEnabled }: Readonly<FilePreviewProps>) {
  const { messages } = useI18n()
  const [failed, setFailed] = useState(false)
  const close = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    close.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const download = () => {
    setFailed(false)
    save(file).catch(() => setFailed(true))
  }

  const isPdf = file.contentType === 'application/pdf'
  return (
    <div className="file-preview-backdrop" data-testid="file-preview-backdrop" onClick={onClose}>
      <div
        className="file-preview"
        role="dialog"
        aria-modal="true"
        aria-label={file.fileName}
        onClick={(event) => event.stopPropagation()}
      >
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
          {isPdf && !inlinePdf ? (
            <a className="button-quiet" href={file.url} target="_blank" rel="noopener noreferrer">
              {messages.attachments.openInNewTab}
            </a>
          ) : null}
          <button type="button" className="button-primary" onClick={download}>
            {messages.attachments.download}
          </button>
          <button type="button" className="button-quiet" onClick={onClose} ref={close}>
            {messages.attachments.close}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Fetches the file and hands it to the browser to save, under the name it was attached as. */
async function save(file: PreviewedFile): Promise<void> {
  const response = await fetch(file.url)
  if (!response.ok) {
    throw new Error(`storage answered ${response.status}`)
  }
  const blob = await response.blob()
  const href = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = file.fileName
    anchor.click()
  } finally {
    // After the click has handed the file over; a later tick keeps Safari from losing it.
    setTimeout(() => URL.revokeObjectURL(href), 0)
  }
}

export default FilePreview
