import { promises as fsp } from 'fs'
import path from 'path'
import {
  EMPTY_SETTINGS,
  addProtected,
  normalizeProtected,
  parseProjectSettings,
  remapProtected,
  removeProtected,
  validPath
} from '../shared/protection'
import type {
  Move,
  ProjectProtection,
  ProtectionDelta,
  ProtectionSettings,
  TreeMenuKind
} from '../shared/types'
import { resolveInside, writeDoc } from './projectFs'

export const SETTINGS_REL = '.canonball/project.json'

/** Reads the settings file. Never writes, even when it is version 1. */
export async function loadProjectProtection(root: string): Promise<ProjectProtection> {
  let text: string
  try {
    text = await fsp.readFile(resolveInside(root, SETTINGS_REL), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { settings: EMPTY_SETTINGS, needsProtectPrompt: true, unreadable: false }
    }
    return { settings: EMPTY_SETTINGS, needsProtectPrompt: false, unreadable: true }
  }
  let parsed: ProtectionSettings | null
  try {
    parsed = parseProjectSettings(JSON.parse(text))
  } catch {
    parsed = null
  }
  if (!parsed) return { settings: EMPTY_SETTINGS, needsProtectPrompt: false, unreadable: true }
  return { settings: parsed, needsProtectPrompt: false, unreadable: false }
}

export async function saveProjectSettings(
  root: string,
  s: ProtectionSettings
): Promise<ProjectProtection> {
  await fsp.mkdir(path.dirname(resolveInside(root, SETTINGS_REL)), { recursive: true })
  await writeDoc(root, SETTINGS_REL, JSON.stringify(s, null, 2) + '\n')
  return loadProjectProtection(root)
}

/** An unreadable file is never overwritten: the writer fixes or removes it first. */
async function requireReadable(root: string): Promise<void> {
  const loaded = await loadProjectProtection(root)
  if (loaded.unreadable) throw new Error('Project settings file is unreadable')
}

/** Tail of the pending mutations per project root, so read-modify-writes never overlap. */
const queues = new Map<string, Promise<unknown>>()

function serialized<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const key = path.resolve(root)
  const run = (queues.get(key) ?? Promise.resolve()).then(fn)
  const tail = run.catch(() => undefined)
  queues.set(key, tail)
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key)
  })
  return run
}

/** Replaces the protected list, always writing version 2. */
export async function setProtectedPaths(root: string, paths: string[]): Promise<ProjectProtection> {
  if (!paths.every(validPath)) throw new Error('Invalid path')
  return serialized(root, async () => {
    await requireReadable(root)
    return saveProjectSettings(root, { version: 2, protected: normalizeProtected(paths) })
  })
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((p, i) => p === b[i])
}

function deltaBetween(before: string[], after: string[]): ProtectionDelta {
  return {
    added: after.filter((p) => !before.includes(p)),
    removed: before.filter((p) => !after.includes(p))
  }
}

/**
 * Reads the list on disk right now, refusing an unreadable file, and writes
 * `change(list)` only when it differs.
 */
async function updateProtected(
  root: string,
  change: (current: string[]) => string[]
): Promise<{ protection: ProjectProtection; before: string[]; after: string[] }> {
  const fresh = await loadProjectProtection(root)
  if (fresh.unreadable) throw new Error('Project settings file is unreadable')
  const before = fresh.settings.protected
  const after = change(before)
  if (sameList(before, after)) return { protection: fresh, before, after: before }
  const protection = await saveProjectSettings(root, { version: 2, protected: after })
  return { protection, before, after }
}

function validMoves(moves: Move[]): boolean {
  return moves.every((m) => validPath(m.from) && validPath(m.to))
}

/**
 * Keeps protection in step with a move. `'before'` adds each remapped entry
 * alongside the old one, so the item is protected at both paths while it
 * moves; `'after'` leaves only the remapped list.
 */
export async function remapProtection(
  root: string,
  moves: Move[],
  phase: 'before' | 'after'
): Promise<ProjectProtection> {
  if (!validMoves(moves)) throw new Error('Invalid path')
  return serialized(root, async () => {
    const out = await updateProtected(root, (current) =>
      phase === 'before'
        ? normalizeProtected([...current, ...remapProtected(current, moves)])
        : remapProtected(current, moves)
    )
    return out.protection
  })
}

/** Protects or unprotects several paths at once and reports the exact change. */
export async function changeProtectionMany(
  root: string,
  kind: TreeMenuKind,
  relPaths: string[]
): Promise<{ protection: ProjectProtection; delta: ProtectionDelta }> {
  if (!relPaths.every(validPath)) throw new Error('Invalid path')
  return serialized(root, async () => {
    const out = await updateProtected(root, (current) =>
      relPaths.reduce(
        (list, p) => (kind === 'protect' ? addProtected(list, p) : removeProtected(list, p)),
        current
      )
    )
    return { protection: out.protection, delta: deltaBetween(out.before, out.after) }
  })
}

/** Applies a change to the list on disk now (never a snapshot). Undo passes the reverse. */
export async function applyProtectionDelta(
  root: string,
  delta: ProtectionDelta
): Promise<{ protection: ProjectProtection; applied: ProtectionDelta }> {
  if (!delta.added.every(validPath) || !delta.removed.every(validPath)) {
    throw new Error('Invalid path')
  }
  return serialized(root, async () => {
    const out = await updateProtected(root, (current) =>
      normalizeProtected([...current.filter((p) => !delta.removed.includes(p)), ...delta.added])
    )
    return { protection: out.protection, applied: deltaBetween(out.before, out.after) }
  })
}
