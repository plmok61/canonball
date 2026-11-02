import { describe, expect, it } from 'vitest'
import { displayName } from './paths'

describe('displayName', () => {
  it('strips a trailing .md', () => expect(displayName('draft2.md')).toBe('draft2'))
  it('leaves folder names alone', () => expect(displayName('notes')).toBe('notes'))
})
