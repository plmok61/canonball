import type { Access, ProjectSettings } from './types'

export const EMPTY_SETTINGS: ProjectSettings = { version: 1, prose: [], access: {} }

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  version: 1,
  prose: ['drafts'],
  access: {
    canon: 'edit',
    notes: 'edit',
    outline: 'read',
    drafts: 'read',
    sessions: 'edit',
    memory: 'read'
  }
}

export const ACCESS_BADGE: Record<Access, { glyph: string; label: string }> = {
  edit: { glyph: '✎', label: 'AI can read and edit' },
  read: { glyph: '👁', label: 'AI can read only' },
  hidden: { glyph: '⊘', label: "AI can't see it" }
}

const ACCESS_VALUES: readonly Access[] = ['edit', 'read', 'hidden']

/** True when `path` is `base` or lies under it, matching whole segments. */
function atOrUnder(path: string, base: string): boolean {
  return path === base || path.startsWith(base + '/')
}

export function isProse(s: ProjectSettings, relPath: string): boolean {
  if (relPath === '') return false
  return s.prose.some((p) => atOrUnder(relPath, p))
}

function clamp(s: ProjectSettings, relPath: string, a: Access): Access {
  return a === 'edit' && isProse(s, relPath) ? 'read' : a
}

/** The path itself and each ancestor, nearest first, excluding the root. */
function selfAndAncestors(relPath: string): string[] {
  const parts = relPath.split('/')
  const out: string[] = []
  for (let i = parts.length; i > 0; i--) out.push(parts.slice(0, i).join('/'))
  return out
}

function lookup(s: ProjectSettings, paths: string[]): Access {
  for (const p of paths) {
    if (Object.prototype.hasOwnProperty.call(s.access, p)) return s.access[p]
  }
  return 'read'
}

export function effectiveAccess(s: ProjectSettings, relPath: string): Access {
  if (relPath === '') return 'read'
  return clamp(s, relPath, lookup(s, selfAndAncestors(relPath)))
}

export function isExplicit(s: ProjectSettings, relPath: string): boolean {
  return Object.prototype.hasOwnProperty.call(s.access, relPath)
}

export function nextAccess(s: ProjectSettings, relPath: string): Access {
  const cur = effectiveAccess(s, relPath)
  if (isProse(s, relPath)) return cur === 'read' ? 'hidden' : 'read'
  return cur === 'edit' ? 'read' : cur === 'read' ? 'hidden' : 'edit'
}

export function withAccess(s: ProjectSettings, relPath: string, a: Access): ProjectSettings {
  const value = clamp(s, relPath, a)
  const rest = { ...s.access }
  delete rest[relPath]
  const inherited = clamp(
    s,
    relPath,
    lookup({ ...s, access: rest }, selfAndAncestors(relPath).slice(1))
  )
  if (value === inherited) return { ...s, access: rest }
  return { ...s, access: { ...rest, [relPath]: value } }
}

export function withProse(s: ProjectSettings, prose: string[]): ProjectSettings {
  const access: Record<string, Access> = {}
  for (const [k, v] of Object.entries(s.access)) {
    if (v === 'edit' && prose.some((p) => atOrUnder(k, p))) continue
    access[k] = v
  }
  return { ...s, prose: [...prose], access }
}

/** The rule for every settings key and prose entry: a non-empty, project-relative path. */
export function validPath(p: unknown): p is string {
  return (
    typeof p === 'string' &&
    p !== '' &&
    p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..')
  )
}

export function parseProjectSettings(raw: unknown): ProjectSettings | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (r.version !== 1) return null
  if (!Array.isArray(r.prose) || !r.prose.every(validPath)) return null
  if (typeof r.access !== 'object' || r.access === null || Array.isArray(r.access)) return null
  const access: Record<string, Access> = {}
  for (const [k, v] of Object.entries(r.access)) {
    if (!validPath(k) || !ACCESS_VALUES.includes(v as Access)) return null
    access[k] = v as Access
  }
  return { version: 1, prose: [...(r.prose as string[])], access }
}
