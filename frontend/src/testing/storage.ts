/**
 * Storage's side of an upload, as the board's tests see it: an `XMLHttpRequest` that records where
 * each file went and what it was, reports half of it sent, then answers 200.
 *
 * Three test files once carried a copy of their own (#431). A test that needs storage to answer
 * otherwise -- later, or not at all -- extends it and overrides `send`.
 */
type Progress = { loaded: number; total: number; lengthComputable: boolean }

export class StorageXhr {
  /** Where each upload went, in order. */
  static urls: string[] = []
  /** What each upload sent, in order. */
  static bodies: unknown[] = []
  status = 0
  upload = { onprogress: null as ((event: Progress) => void) | null, onload: null as (() => void) | null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  private url = ''

  open(_method: string, url: string) {
    this.url = url
  }

  setRequestHeader() {}

  send(body: unknown) {
    StorageXhr.urls.push(this.url)
    StorageXhr.bodies.push(body)
    this.upload.onprogress?.({ loaded: 1, total: 2, lengthComputable: true })
    this.status = 200
    this.onload?.()
  }

  abort() {
    this.onabort?.()
  }
}
