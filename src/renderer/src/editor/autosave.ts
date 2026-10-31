export interface AutosaveOptions {
  delayMs: number
  save: (content: string) => Promise<void>
  initial: string
  /** Called whenever `dirty` may have changed. */
  onDirtyChange?: (dirty: boolean) => void
}

/** Debounced saver. Never saves content equal to what was last saved. */
export class Autosave {
  private readonly opts: AutosaveOptions
  private lastSaved: string
  private pending: string | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private inFlight: Promise<void> | null = null
  private lastDirty = false

  constructor(opts: AutosaveOptions) {
    this.opts = opts
    this.lastSaved = opts.initial
  }

  get dirty(): boolean {
    return this.pending !== null || this.inFlight !== null
  }

  change(content: string): void {
    this.clearTimer()
    if (content === this.lastSaved) {
      this.pending = null
    } else {
      this.pending = content
      this.timer = setTimeout(() => void this.flush().catch(() => {}), this.opts.delayMs)
    }
    this.notify()
  }

  async flush(): Promise<void> {
    this.clearTimer()
    // Wait for any save in flight, then write whatever is still pending.
    while (this.inFlight || this.pending !== null) {
      if (this.inFlight) {
        await this.inFlight.catch(() => {})
        continue
      }
      const content = this.pending as string
      this.pending = null
      const run = this.opts.save(content).then(
        () => {
          this.lastSaved = content
        },
        (err) => {
          // keep the text so the next change or flush retries it
          this.pending ??= content
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

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private notify(): void {
    const d = this.dirty
    if (d !== this.lastDirty) {
      this.lastDirty = d
      this.opts.onDirtyChange?.(d)
    }
  }
}
