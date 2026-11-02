import { remapPath } from './fileNames'
import type { Move, ProtectionSettings } from './types'

export const EMPTY_SETTINGS: ProtectionSettings = { version: 2, protected: [] }

export const DEFAULT_PROJECT_SETTINGS: ProtectionSettings = { version: 2, protected: ['drafts'] }

/** True when `path` is `base` or lies under it, matching whole segments. */
function atOrUnder(path: string, base: string): boolean {
  return path === base || path.startsWith(base + '/')
}

/** The rule for every protected entry: a non-empty, project-relative path. */
export function validPath(p: unknown): p is string {
  return (
    typeof p === 'string' &&
    p !== '' &&
    p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..')
  )
}

/** Protection is by path, not by what is on disk. The project root is never protected. */
export function isProtected(s: ProtectionSettings, relPath: string): boolean {
  if (relPath === '') return false
  return s.protected.some((p) => atOrUnder(relPath, p))
}

/** Dedupes and drops any entry under another entry, keeping first-seen order. */
export function normalizeProtected(paths: string[]): string[] {
  const unique = [...new Set(paths)]
  return unique.filter((p) => !unique.some((other) => other !== p && atOrUnder(p, other)))
}

export function addProtected(paths: string[], relPath: string): string[] {
  return normalizeProtected([...paths, relPath])
}

/** Removes only that exact entry. */
export function removeProtected(paths: string[], relPath: string): string[] {
  return paths.filter((p) => p !== relPath)
}

/** Reads version 2, or version 1 (`prose` becomes `protected`, `access` ignored). */
export function parseProjectSettings(raw: unknown): ProtectionSettings | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const list = r.version === 2 ? r.protected : r.version === 1 ? r.prose : null
  if (!Array.isArray(list) || !list.every(validPath)) return null
  return { version: 2, protected: normalizeProtected(list) }
}

/** Follows renames and moves: remaps each entry through every move, then normalizes. */
export function remapProtected(list: string[], moves: Move[]): string[] {
  return normalizeProtected(list.map((p) => moves.reduce((acc, m) => remapPath(acc, m), p)))
}
