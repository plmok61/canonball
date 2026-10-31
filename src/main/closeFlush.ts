import type { FlushResult } from '../shared/types'

export type { FlushResult }

export const SLOW_SAVE_DETAIL = 'Saving is taking longer than expected.'

export interface CloseFlushDeps {
  requestFlush(): void
  /** Subscribe to the renderer's flush-done reply; returns an unsubscribe. */
  onFlushDone(cb: (result: FlushResult) => void): () => void
  /** Schedule cb after the flush timeout; returns a canceller. */
  setTimer(cb: () => void): () => void
  /**
   * Tell the writer some changes could not be saved. Resolves true to close
   * anyway, false to keep the window open.
   */
  confirmQuitAnyway(detail: string): Promise<boolean>
  closeWindow(): void
  quitApp(): void
  isQuitting(): boolean
  /** The quit that triggered this close was abandoned; a later quit starts over. */
  cancelQuit(): void
}

/** Returns a window 'close' handler implementing the flush-before-close handshake. */
export function createCloseHandler(deps: CloseFlushDeps) {
  // idle: no handshake; flushing: handshake or dialog running; closing: our own close.
  let state: 'idle' | 'flushing' | 'closing' = 'idle'

  const proceed = (): void => {
    state = 'closing'
    const quitting = deps.isQuitting()
    deps.closeWindow()
    // A quit-triggered close was cancelled by preventDefault; re-issue it.
    if (quitting) deps.quitApp()
  }

  const abort = (): void => {
    state = 'idle'
    deps.cancelQuit()
  }

  return (event: { preventDefault(): void }): void => {
    if (state === 'closing') return
    event.preventDefault()
    if (state === 'flushing') return
    state = 'flushing'
    let done = false
    const finish = (result: FlushResult): void => {
      if (done) return
      done = true
      unsubscribe()
      cancelTimer()
      if (result.ok) {
        proceed()
        return
      }
      deps
        .confirmQuitAnyway(result.error || 'Unknown error')
        .catch(() => false)
        .then((quitAnyway) => (quitAnyway ? proceed() : abort()))
    }
    const unsubscribe = deps.onFlushDone(finish)
    const cancelTimer = deps.setTimer(() => finish({ ok: false, error: SLOW_SAVE_DETAIL }))
    deps.requestFlush()
  }
}
