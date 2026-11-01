import { describe, expect, it } from 'vitest'
import {
  addProtected,
  isProtected,
  normalizeProtected,
  parseProjectSettings,
  removeProtected
} from './protection'

const s = (paths: string[]) => ({ version: 2 as const, protected: paths })

describe('isProtected', () => {
  it('matches entries and paths under them by whole segments', () => {
    expect(isProtected(s(['drafts']), 'drafts/ch1.md')).toBe(true)
    expect(isProtected(s(['drafts']), 'drafts')).toBe(true)
    expect(isProtected(s(['drafts']), 'drafts2/x.md')).toBe(false)
    expect(isProtected(s(['drafts']), '')).toBe(false)
  })

  it('protects by path, not by what is on disk', () => {
    expect(isProtected(s(['gone']), 'gone/new.md')).toBe(true)
  })
})

describe('protected list helpers', () => {
  it('normalizes', () => {
    expect(normalizeProtected(['book/ch', 'book', 'notes', 'book'])).toEqual(['book', 'notes'])
  })
  it('adds', () => {
    expect(addProtected(['book/ch'], 'book')).toEqual(['book'])
  })
  it('removes only the exact entry', () => {
    expect(removeProtected(['a', 'b'], 'a')).toEqual(['b'])
    expect(removeProtected(['a'], 'a/x')).toEqual(['a'])
  })
})

describe('parseProjectSettings', () => {
  it('reads version 2', () => {
    expect(parseProjectSettings({ version: 2, protected: ['drafts'] })).toEqual(s(['drafts']))
  })
  it('reads version 1, ignoring access', () => {
    expect(
      parseProjectSettings({ version: 1, prose: ['drafts'], access: { canon: 'edit' } })
    ).toEqual(s(['drafts']))
    expect(parseProjectSettings({ version: 1, prose: ['drafts'], access: { x: 'bogus' } })).toEqual(
      s(['drafts'])
    )
  })
  it('rejects invalid input', () => {
    expect(parseProjectSettings({ version: 1, prose: ['../x'] })).toBeNull()
    expect(parseProjectSettings({ version: 2, protected: 'drafts' })).toBeNull()
    expect(parseProjectSettings({ version: 3, protected: [] })).toBeNull()
  })
  it('normalizes the list', () => {
    expect(parseProjectSettings({ version: 2, protected: ['a', 'a/b'] })).toEqual(s(['a']))
  })
})
