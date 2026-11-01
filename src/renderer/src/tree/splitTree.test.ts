import { expect, it } from 'vitest'
import type { TreeNode } from '../../../shared/types'
import { splitTree } from './splitTree'

const ch: TreeNode = { name: 'ch', relPath: 'book/ch', kind: 'folder', children: [] }
const book: TreeNode = { name: 'book', relPath: 'book', kind: 'folder', children: [ch] }
const drafts: TreeNode = { name: 'drafts', relPath: 'drafts', kind: 'folder', children: [] }
const readme: TreeNode = { name: 'README.md', relPath: 'README.md', kind: 'file' }
const tree = [book, drafts, readme]

it('top-level folder moves to protected', () => {
  const { protectedRoots, rest } = splitTree(tree, ['drafts'])
  expect(protectedRoots).toEqual([{ node: drafts, parentPath: '' }])
  expect(rest.map((n) => n.relPath)).toEqual(['book', 'README.md'])
})

it('nested entry keeps its parent in rest', () => {
  const { protectedRoots, rest } = splitTree(tree, ['book/ch'])
  expect(protectedRoots).toEqual([{ node: ch, parentPath: 'book' }])
  expect(rest.find((n) => n.relPath === 'book')).toEqual({ ...book, children: [] })
})

it('protected file at top level', () => {
  const { protectedRoots, rest } = splitTree(tree, ['README.md'])
  expect(protectedRoots).toEqual([{ node: readme, parentPath: '' }])
  expect(rest.map((n) => n.relPath)).toEqual(['book', 'drafts'])
})

it('missing entry is skipped', () => {
  const { protectedRoots, rest } = splitTree(tree, ['gone'])
  expect(protectedRoots).toEqual([])
  expect(rest).toEqual(tree)
})

it('roots come in tree order, not settings order', () => {
  const { protectedRoots } = splitTree(tree, ['drafts', 'book'])
  expect(protectedRoots.map((r) => r.node.relPath)).toEqual(['book', 'drafts'])
})
