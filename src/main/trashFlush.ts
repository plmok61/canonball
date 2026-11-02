import { promises as fsp } from 'fs'
import path from 'path'

/** Where trashed items wait (`<id>/<name>`) so undo can bring them back. */
export const HOLDING_REL = path.join('.canonball', 'trash')

async function listOrEmpty(dir: string): Promise<string[]> {
  try {
    return await fsp.readdir(dir)
  } catch {
    return []
  }
}

/**
 * Moves everything in the holding area to the system Trash and removes the
 * emptied `<id>` folders. A missing holding area is fine, and one item that
 * can't be trashed is logged and left in place without stopping the rest.
 */
export async function flushHoldingArea(
  root: string,
  trashItem: (fullPath: string) => Promise<void>
): Promise<void> {
  const hold = path.join(root, HOLDING_REL)
  // A linked .canonball or trash folder could point anywhere; refuse unless it truly lives in the project.
  try {
    const realHold = await fsp.realpath(hold)
    const realRoot = await fsp.realpath(root)
    if (realHold !== path.join(realRoot, HOLDING_REL)) return
  } catch {
    return
  }
  for (const id of await listOrEmpty(hold)) {
    if (id !== path.basename(id)) continue
    const idDir = path.join(hold, id)
    const info = await fsp.lstat(idDir).catch(() => null)
    if (!info || !info.isDirectory() || info.isSymbolicLink()) continue
    for (const name of await listOrEmpty(idDir)) {
      try {
        await trashItem(path.join(idDir, name))
      } catch (err) {
        console.error('Could not move to Trash:', path.join(idDir, name), err)
      }
    }
    // Only succeeds when empty, so a failed item keeps its folder.
    await fsp.rmdir(idDir).catch(() => {})
  }
}
