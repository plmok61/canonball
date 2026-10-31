import { MAX_LINT_CHARS } from '../../shared/grammar'
import type { GrammarLint } from '../../shared/types'

export { MAX_LINT_CHARS }

export function parseLintRequest(input: unknown): string[] {
  if (!Array.isArray(input)) throw new Error('Invalid grammar request')
  let total = 0
  for (const item of input) {
    if (typeof item !== 'string') throw new Error('Invalid grammar request')
    total += item.length
    if (total > MAX_LINT_CHARS) throw new Error('Invalid grammar request')
  }
  return input as string[]
}

/** Electron's UtilityProcess satisfies this. */
export interface GrammarChild {
  postMessage(msg: unknown): void
  on(event: 'message', cb: (msg: unknown) => void): unknown
  on(event: 'exit', cb: (code: number) => void): unknown
  on(event: 'error', cb: (...args: unknown[]) => void): unknown
  kill(): boolean
}

interface Pending {
  /** The child this request was sent to. */
  child: GrammarChild
  resolve(lints: GrammarLint[][]): void
  reject(err: Error): void
}

export function createGrammarService(fork: () => GrammarChild): {
  lint(texts: string[]): Promise<GrammarLint[][]>
  dispose(): void
} {
  let child: GrammarChild | null = null
  let nextId = 1
  const pending = new Map<number, Pending>()

  function start(): GrammarChild {
    const c = fork()
    c.on('message', (msg) => {
      const m = msg as { id?: unknown; lints?: unknown; error?: unknown } | null
      if (!m || typeof m.id !== 'number') return
      const p = pending.get(m.id)
      if (!p) return
      pending.delete(m.id)
      if (m.error !== undefined) p.reject(new Error(String(m.error)))
      else if (Array.isArray(m.lints)) p.resolve(m.lints as GrammarLint[][])
      else p.reject(new Error('Invalid grammar reply'))
    })
    // Fatal errors arrive before 'exit'; without a listener EventEmitter throws.
    c.on('error', (...args) => {
      console.warn('Grammar checker error:', ...args)
    })
    c.on('exit', () => {
      if (child === c) child = null
      for (const [id, p] of pending) {
        if (p.child !== c) continue
        pending.delete(id)
        p.reject(new Error('Grammar checker stopped'))
      }
    })
    return c
  }

  return {
    lint(texts) {
      const c = (child ??= start())
      const id = nextId++
      return new Promise((resolve, reject) => {
        pending.set(id, { child: c, resolve, reject })
        try {
          c.postMessage({ id, texts })
        } catch (err) {
          pending.delete(id)
          reject(err instanceof Error ? err : new Error(String(err)))
        }
      })
    },
    dispose() {
      const c = child
      child = null
      c?.kill()
    }
  }
}
