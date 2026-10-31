import type { GrammarLint } from '../../shared/types'

export const MAX_LINT_CHARS = 200_000

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
  kill(): boolean
}

interface Pending {
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
      const m = msg as { id?: number; lints?: GrammarLint[][]; error?: string } | null
      if (!m || typeof m.id !== 'number') return
      const p = pending.get(m.id)
      if (!p) return
      pending.delete(m.id)
      if (m.error !== undefined) p.reject(new Error(m.error))
      else p.resolve(m.lints ?? [])
    })
    c.on('exit', () => {
      if (child === c) child = null
      for (const p of pending.values()) p.reject(new Error('Grammar checker stopped'))
      pending.clear()
    })
    return c
  }

  return {
    lint(texts) {
      child ??= start()
      const id = nextId++
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        child!.postMessage({ id, texts })
      })
    },
    dispose() {
      const c = child
      child = null
      c?.kill()
    }
  }
}
