import { describe, expect, it } from 'vitest'
import { copyName, isAtOrUnder, nameError, remapPath, topmost, withMd } from './fileNames'

describe('nameError', () => {
  it('rejects bad names with the right message', () => {
    expect(nameError('')).toBe('Enter a name.')
    expect(nameError('.x')).toBe("Names can't start with a dot.")
    expect(nameError('a/b')).toBe("Names can't contain / or :.")
    expect(nameError('a:b')).toBe("Names can't contain / or :.")
    expect(nameError('node_modules')).toBe('That name is reserved.')
  })
  it('accepts a normal name', () => {
    expect(nameError('Chapter 1')).toBeNull()
  })
})

describe('withMd', () => {
  it('adds .md only when missing, case-insensitively', () => {
    expect(withMd('ch')).toBe('ch.md')
    expect(withMd('ch.MD')).toBe('ch.MD')
  })
})

describe('copyName', () => {
  it('numbers copies and keeps .md for files', () => {
    expect(copyName('x.md', 'file', (n) => ['x.md', 'x copy.md'].includes(n))).toBe('x copy 2.md')
    expect(copyName('notes', 'folder', (n) => n === 'notes')).toBe('notes copy')
  })
  it('returns the name itself when free', () => {
    expect(copyName('x.md', 'file', () => false)).toBe('x.md')
  })
})

describe('paths', () => {
  it('isAtOrUnder matches whole segments', () => {
    expect(isAtOrUnder('book', 'book')).toBe(true)
    expect(isAtOrUnder('book/a.md', 'book')).toBe(true)
    expect(isAtOrUnder('bookish/a.md', 'book')).toBe(false)
  })
  it('remapPath', () => {
    expect(remapPath('book/ch/a.md', { from: 'book', to: 'novel' })).toBe('novel/ch/a.md')
    expect(remapPath('book', { from: 'book', to: 'novel' })).toBe('novel')
    expect(remapPath('bookish/a.md', { from: 'book', to: 'novel' })).toBe('bookish/a.md')
  })
  it('topmost drops nested entries and keeps order', () => {
    expect(topmost(['a', 'a/b', 'c'])).toEqual(['a', 'c'])
    expect(topmost(['a/b', 'a'])).toEqual(['a'])
  })
})
