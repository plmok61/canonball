import { expect, it } from 'vitest'
import { dropTarget } from './dragDrop'

it('a folder target is the destination', () => {
  expect(dropTarget(['notes/a.md'], { relPath: 'canon', kind: 'folder' })).toBe('canon')
})

it('refuses a folder onto its own descendant or itself', () => {
  expect(dropTarget(['book'], { relPath: 'book/ch', kind: 'folder' })).toBeNull()
  expect(dropTarget(['book'], { relPath: 'book', kind: 'folder' })).toBeNull()
})

it('a file target means its folder, and refuses when everything is already there', () => {
  expect(dropTarget(['notes/a.md'], { relPath: 'notes/b.md', kind: 'file' })).toBeNull()
  expect(dropTarget(['notes/a.md'], { relPath: 'canon/b.md', kind: 'file' })).toBe('canon')
})

it('empty space is the top level', () => {
  expect(dropTarget(['notes/a.md'], { relPath: null, kind: null })).toBe('')
  expect(dropTarget(['a.md'], { relPath: null, kind: null })).toBeNull()
})

it('uses the topmost of the dragged items', () => {
  expect(dropTarget(['book', 'book/a.md'], { relPath: 'book/ch', kind: 'folder' })).toBeNull()
  expect(dropTarget(['book/a.md', 'book/b.md'], { relPath: 'book', kind: 'folder' })).toBeNull()
})

it('a copy into the items own folder is allowed, but never a folder into itself', () => {
  expect(dropTarget(['notes/a.md'], { relPath: 'notes', kind: 'folder' }, true)).toBe('notes')
  expect(dropTarget(['notes/a.md'], { relPath: 'notes', kind: 'folder' })).toBeNull()
  expect(dropTarget(['book'], { relPath: 'book/ch', kind: 'folder' }, true)).toBeNull()
})
