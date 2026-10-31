import { describe, expect, it } from 'vitest'
import { displayName, isProsePath } from './paths'

describe('displayName', () => {
  it('strips a trailing .md', () => expect(displayName('draft2.md')).toBe('draft2'))
  it('leaves folder names alone', () => expect(displayName('notes')).toBe('notes'))
})

describe('isProsePath', () => {
  it('is true under drafts/', () => expect(isProsePath('drafts/chapters/1/draft1.md')).toBe(true))
  it('is false elsewhere', () => expect(isProsePath('canon/world.md')).toBe(false))
})
