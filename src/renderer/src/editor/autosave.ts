export interface AutosaveOptions {
  delayMs: number
  save: (content: string) => Promise<void>
  initial: string
  /** Called whenever `dirty` may have changed. */
  onDirtyChange?: (dirty: boolean) => void
  /** Called when the last save attempt starts failing or recovers. */
  onErrorChange?: (failed: boolean) => void
  /** Wait before retrying a failed save while this instance is live. Default 2000. */
  retryMs?: number
}

/** Debounced saver. Never saves content equal to what was last saved. */
export class Autosave {
  private readonly opts: AutosaveOptions
  private lastSaved: string
  private pending: string | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private inFlight: Promise<void> | null = null
  private lastDirty = false
  private failed = false
  private detached = false

  constructor(opts: AutosaveOptions) {
    this.opts = opts
    this.lastSaved = opts.initial
  }

  get dirty(): boolean {
    return this.pending !== null || this.inFlight !== null
  }

  /** Text accepted by change() that has not reached disk, if any. */
  get unsaved(): string | null {
    return this.pending
  }

  get hasFailed(): boolean {
    return this.failed
  }

  change(content: string): void {
    this.clearTimer()
    if (content === this.lastSaved) {
      this.pending = null
      this.setFailed(false)
    } else {
      this.pending = content
      this.timer = setTimeout(() => void this.flush().catch(() => {}), this.opts.delayMs)
    }
    this.notify()
  }

  /** Stop scheduling saves and retries; the owner now drives `flush()` itself. */
  detach(): void {
    this.detached = true
    this.clearTimer()
  }

  async flush(): Promise<void> {
    this.clearTimer()
    // Wait for any save in flight, then write whatever is still pending.
    while (this.inFlight || this.pending !== null) {
      if (this.inFlight) {
        await this.inFlight.catch(() => {})
        if (this.failed && this.pending !== null) throw new Error('save failed')
        continue
      }
      const content = this.pending as string
      this.pending = null
      const run = this.opts.save(content).then(
        () => {
          this.lastSaved = content
          this.setFailed(false)
        },
        (err) => {
          // keep the text so the next change, retry or flush writes it
          this.pending ??= content
          this.setFailed(true)
          this.scheduleRetry()
          throw err
        }
      )
      this.inFlight = run
      this.notify()
      try {
        await run
      } finally {
        this.inFlight = null
        this.notify()
      }
    }
  }

  private scheduleRetry(): void {
    if (this.detached || this.timer) return
    this.timer = setTimeout(() => void this.flush().catch(() => {}), this.opts.retryMs ?? 2000)
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private setFailed(failed: boolean): void {
    if (failed === this.failed) return
    this.failed = failed
    this.opts.onErrorChange?.(failed)
  }

  private notify(): void {
    const d = this.dirty
    if (d !== this.lastDirty) {
      this.lastDirty = d
      this.opts.onDirtyChange?.(d)
    }
  }
}
