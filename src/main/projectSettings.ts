import { promises as fsp } from 'fs'
import path from 'path'
import {
  EMPTY_SETTINGS,
  addProtected,
  normalizeProtected,
  parseProjectSettings,
  removeProtected,
  validPath
} from '../shared/protection'
import type { ProjectProtection, ProtectionSettings, TreeMenuKind } from '../shared/types'
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

/**
 * Protects or unprotects one path against the list on disk right now, so an
 * outside edit is never overwritten by a stale list. Writes only on a change.
 */
export async function changeProtection(
  root: string,
  kind: TreeMenuKind,
  relPath: string
): Promise<ProjectProtection> {
  if (!validPath(relPath)) throw new Error('Invalid path')
  return serialized(root, async () => {
    const fresh = await loadProjectProtection(root)
    if (fresh.unreadable) throw new Error('Project settings file is unreadable')
    const current = fresh.settings.protected
    const next =
      kind === 'protect' ? addProtected(current, relPath) : removeProtected(current, relPath)
    if (next.length === current.length && next.every((p, i) => p === current[i])) return fresh
    return saveProjectSettings(root, { version: 2, protected: next })
  })
}
