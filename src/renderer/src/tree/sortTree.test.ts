import { expect, it } from 'vitest'
import type { TreeNode } from '../../../shared/types'
import { sortTree } from './sortTree'

const f = (name: string): TreeNode => ({ name, relPath: name, kind: 'file' })

it('puts chapter 10 after chapter 2', () => {
  const out = sortTree([f('Chapter 10.md'), f('Chapter 2.md'), f('Chapter 1.md')])
  expect(out.map((n) => n.name)).toEqual(['Chapter 1.md', 'Chapter 2.md', 'Chapter 10.md'])
})

it('puts folders before files', () => {
  const folder: TreeNode = {
    name: 'zeta',
    relPath: 'zeta',
    kind: 'folder',
    children: [f('b.md'), f('a.md')]
  }
  const out = sortTree([f('a.md'), folder])
  expect(out.map((n) => n.name)).toEqual(['zeta', 'a.md'])
  expect(out[0].children?.map((n) => n.name)).toEqual(['a.md', 'b.md'])
})
