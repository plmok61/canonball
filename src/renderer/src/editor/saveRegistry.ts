import type { Autosave } from './autosave'

const RETRY_MS = 2000

interface Orphan {
  autosave: Autosave
  done: Promise<void>
}

/**
 * Autosaves whose editor is gone but whose text has not reached disk yet.
 * At most one per path, so there is only ever one writer for a file.
 */
const orphans = new Map<string, Orphan>()

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Take over an Autosave on unmount: keep retrying until its text is saved. */
export function orphan(path: string, autosave: Autosave): void {
  autosave.detach()
  if (!autosave.dirty) return
  const previous = orphans.get(path)?.done ?? Promise.resolve()
  const entry: Orphan = { autosave, done: Promise.resolve() }
  entry.done = (async () => {
    await previous
    // Stop if the entry was adopted, replaced or reset in the meantime.
    while (orphans.get(path) === entry && autosave.dirty) {
      try {
        await autosave.flush()
      } catch {
        await sleep(RETRY_MS)
      }
    }
    if (orphans.get(path) === entry) orphans.delete(path)
  })()
  orphans.set(path, entry)
}

/**
 * Called before a file is opened. Waits for a pending orphan save of the same
 * path to finish. If it still cannot save, removes the orphan and returns its
 * unsaved text so the new editor can adopt it (the new editor becomes the one
 * writer). Returns null when nothing needs adopting.
 */
export async function settleOrphan(path: string): Promise<string | null> {
  const entry = orphans.get(path)
  if (!entry) return null
  try {
    await entry.autosave.flush()
    if (orphans.get(path) === entry) orphans.delete(path)
    return null
  } catch {
    if (orphans.get(path) === entry) orphans.delete(path)
    return entry.autosave.unsaved
  }
}

/** Flush the live autosave and every orphan; rejects if any still fails. */
export async function flushAll(live: Autosave | null): Promise<void> {
  const all = [...(live ? [live] : []), ...[...orphans.values()].map((o) => o.autosave)]
  const results = await Promise.allSettled(all.map((a) => a.flush()))
  const failed = results.find((r) => r.status === 'rejected')
  if (failed) throw (failed as PromiseRejectedResult).reason
}

export function __resetSaveRegistryForTests(): void {
  orphans.clear()
}
