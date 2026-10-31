export interface CloseFlushDeps {
  requestFlush(): void
  /** Subscribe to the renderer's flush-done reply; returns an unsubscribe. */
  onFlushDone(cb: () => void): () => void
  /** Schedule cb after the flush timeout; returns a canceller. */
  setTimer(cb: () => void): () => void
  closeWindow(): void
  quitApp(): void
  isQuitting(): boolean
}

/** Returns a window 'close' handler implementing the flush-before-close handshake. */
export function createCloseHandler(deps: CloseFlushDeps) {
  let closing = false
  return (event: { preventDefault(): void }): void => {
    if (closing) return
    event.preventDefault()
    closing = true
    let done = false
    const finish = (): void => {
      if (done) return
      done = true
      unsubscribe()
      cancelTimer()
      deps.closeWindow()
      // A quit-triggered close was cancelled by preventDefault; re-issue it.
      if (deps.isQuitting()) deps.quitApp()
    }
    const unsubscribe = deps.onFlushDone(finish)
    const cancelTimer = deps.setTimer(finish)
    deps.requestFlush()
  }
}
