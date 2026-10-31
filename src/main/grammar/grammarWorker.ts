// Utility-process entry: lints paragraphs with Harper, off the main thread.
import { createHarperLinter, type TextLinter } from './harperLinter'

let linter: Promise<TextLinter> | null = null

process.parentPort.on('message', async (e) => {
  let id: unknown
  try {
    const data = e.data as { id?: unknown; texts?: unknown } | null
    id = data?.id
    const texts = data?.texts
    if (typeof id !== 'number') return
    if (!Array.isArray(texts) || !texts.every((t) => typeof t === 'string')) {
      throw new Error('Invalid grammar request')
    }
    // Retry from scratch if a previous setup failed.
    linter ??= createHarperLinter().catch((err) => {
      linter = null
      throw err
    })
    const lints = await (await linter).lint(texts)
    process.parentPort.postMessage({ id, lints })
  } catch (err) {
    // Only a message with a numeric id can be answered.
    if (typeof id !== 'number') return
    process.parentPort.postMessage({ id, error: err instanceof Error ? err.message : String(err) })
  }
})
