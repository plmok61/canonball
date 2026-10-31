import { describe, expect, it } from 'vitest'
import {
  ACCESS_BADGE,
  DEFAULT_PROJECT_SETTINGS,
  EMPTY_SETTINGS,
  effectiveAccess,
  isExplicit,
  isProse,
  nextAccess,
  parseProjectSettings,
  withAccess,
  withProse
} from './access'
import type { Access, ProjectSettings } from './types'

const mk = (access: Record<string, Access>, prose: string[] = []): ProjectSettings => ({
  version: 1,
  prose,
  access
})

describe('access model', () => {
  it('files inherit the nearest explicit entry', () => {
    const s = mk({ canon: 'edit', 'canon/x': 'hidden' })
    expect(effectiveAccess(s, 'canon/a.md')).toBe('edit')
    expect(effectiveAccess(s, 'canon/x/b.md')).toBe('hidden')
    expect(effectiveAccess(s, 'outline/o.md')).toBe('read')
    expect(effectiveAccess(s, '')).toBe('read')
  })

  it('prose matches whole segments', () => {
    const s = mk({}, ['drafts'])
    expect(isProse(s, 'drafts/c/1.md')).toBe(true)
    expect(isProse(s, 'drafts2/a.md')).toBe(false)
    expect(isProse(s, 'drafts')).toBe(true)
    expect(isProse(mk({}, ['top.md']), 'top.md')).toBe(true)
  })

  it('prose clamps edit to read even with an explicit override', () => {
    const s = mk({ 'drafts/ch1.md': 'edit', drafts: 'edit' }, ['drafts'])
    expect(effectiveAccess(s, 'drafts/ch1.md')).toBe('read')
  })

  it('cycle goes edit, read, hidden and skips edit for prose', () => {
    const s = mk({ canon: 'edit', 'canon/h': 'read', 'canon/z': 'hidden' }, ['drafts'])
    expect(nextAccess(s, 'canon')).toBe('read')
    expect(nextAccess(s, 'canon/h')).toBe('hidden')
    expect(nextAccess(s, 'canon/z')).toBe('edit')
    expect(nextAccess(s, 'drafts/a.md')).toBe('hidden')
    expect(nextAccess(mk({ 'drafts/a.md': 'hidden' }, ['drafts']), 'drafts/a.md')).toBe('read')
  })

  it('cycling to the inherited value removes the override', () => {
    const s = mk({ canon: 'edit' })
    const a = withAccess(s, 'canon/a.md', 'read')
    expect(a.access['canon/a.md']).toBe('read')
    expect(isExplicit(a, 'canon/a.md')).toBe(true)
    const b = withAccess(a, 'canon/a.md', 'edit')
    expect('canon/a.md' in b.access).toBe(false)
    expect(isExplicit(b, 'canon/a.md')).toBe(false)
  })

  it('marking prose drops edit overrides under it', () => {
    const s = mk({ drafts: 'edit', 'drafts/a.md': 'hidden', canon: 'edit' })
    const r = withProse(s, ['drafts'])
    expect(r.prose).toEqual(['drafts'])
    expect(r.access).toEqual({ 'drafts/a.md': 'hidden', canon: 'edit' })
  })

  it('defaults match the spec table', () => {
    expect(DEFAULT_PROJECT_SETTINGS).toEqual({
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
    })
    expect(EMPTY_SETTINGS).toEqual({ version: 1, prose: [], access: {} })
    expect(ACCESS_BADGE.hidden).toEqual({ glyph: '⊘', label: "AI can't see it" })
    expect(ACCESS_BADGE.edit.label).toBe('AI can read and edit')
    expect(ACCESS_BADGE.read.glyph).toBe('👁')
  })

  it('parseProjectSettings rejects wrong shapes', () => {
    const ok = { version: 1, prose: [], access: {} }
    expect(parseProjectSettings(null)).toBeNull()
    expect(parseProjectSettings([])).toBeNull()
    expect(parseProjectSettings({ ...ok, version: 2 })).toBeNull()
    expect(parseProjectSettings({ ...ok, access: { canon: 'write' } })).toBeNull()
    expect(parseProjectSettings({ ...ok, prose: 'drafts' })).toBeNull()
    expect(parseProjectSettings({ ...ok, access: { '/canon': 'edit' } })).toBeNull()
    expect(parseProjectSettings({ ...ok, access: { 'a/../b': 'edit' } })).toBeNull()
    expect(parseProjectSettings({ ...ok, access: { 'canon/': 'edit' } })).toBeNull()
    expect(parseProjectSettings({ ...ok, prose: ['../x'] })).toBeNull()
    expect(parseProjectSettings(DEFAULT_PROJECT_SETTINGS)).toEqual(DEFAULT_PROJECT_SETTINGS)
  })
})
