import type { Autosave } from './autosave'

const RETRY_MS = 2000

/** Autosaves whose editor is gone but whose text has not reached disk yet. */
const orphans = new Set<Autosave>()

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Take over an Autosave on unmount: keep retrying until its text is saved. */
export function orphan(autosave: Autosave): void {
  autosave.detach()
  if (!autosave.dirty) return
  orphans.add(autosave)
  void (async () => {
    while (autosave.dirty) {
      try {
        await autosave.flush()
      } catch {
        await sleep(RETRY_MS)
      }
    }
    orphans.delete(autosave)
  })()
}

/** Flush the live autosave and every orphan; rejects if any still fails. */
export async function flushAll(live: Autosave | null): Promise<void> {
  const all = [...(live ? [live] : []), ...orphans]
  const results = await Promise.allSettled(all.map((a) => a.flush()))
  const failed = results.find((r) => r.status === 'rejected')
  if (failed) throw (failed as PromiseRejectedResult).reason
}
