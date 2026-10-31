// Utility-process entry: lints paragraphs with Harper, off the main thread.
import { createHarperLinter, type TextLinter } from './harperLinter'

let linter: Promise<TextLinter> | null = null

process.parentPort.on('message', async (e) => {
  const { id, texts } = e.data as { id: number; texts: string[] }
  try {
    // Retry from scratch if a previous setup failed.
    linter ??= createHarperLinter().catch((err) => {
      linter = null
      throw err
    })
    const lints = await (await linter).lint(texts)
    process.parentPort.postMessage({ id, lints })
  } catch (err) {
    process.parentPort.postMessage({ id, error: err instanceof Error ? err.message : String(err) })
  }
})
