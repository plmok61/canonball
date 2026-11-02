import { expect, it } from 'vitest'
import type { TreeNode } from '../../../shared/types'
import { arrowSelect, clickSelect, visibleOrder, type Selection } from './selection'

const order = ['a', 'b', 'c', 'd', 'e']
const none: Selection = { paths: [], anchor: null }
const plain = { meta: false, shift: false }

it('a plain click resets to one row', () => {
  const sel = clickSelect({ paths: ['a', 'b'], anchor: 'a' }, 'c', plain, order)
  expect(sel).toEqual({ paths: ['c'], anchor: 'c' })
})

it('cmd-click toggles a row', () => {
  const one = clickSelect({ paths: ['a'], anchor: 'a' }, 'c', { meta: true, shift: false }, order)
  expect(one).toEqual({ paths: ['a', 'c'], anchor: 'c' })
  const off = clickSelect(one, 'a', { meta: true, shift: false }, order)
  expect(off.paths).toEqual(['c'])
})

it('shift-click selects the range from the anchor and keeps the anchor', () => {
  const sel = clickSelect({ paths: ['b'], anchor: 'b' }, 'd', { meta: false, shift: true }, order)
  expect(sel).toEqual({ paths: ['b', 'c', 'd'], anchor: 'b' })
  const up = clickSelect({ paths: ['d'], anchor: 'd' }, 'b', { meta: false, shift: true }, order)
  expect(up.paths).toEqual(['b', 'c', 'd'])
})

it('shift-click with no anchor selects just the target', () => {
  expect(clickSelect(none, 'c', { meta: false, shift: true }, order)).toEqual({
    paths: ['c'],
    anchor: 'c'
  })
})

it('arrowSelect moves and extends', () => {
  const s1 = arrowSelect({ paths: ['b'], anchor: 'b' }, 1, false, order)
  expect(s1).toEqual({ paths: ['c'], anchor: 'c' })
  const s2 = arrowSelect(s1, 1, true, order)
  expect(s2).toEqual({ paths: ['c', 'd'], anchor: 'c' })
  expect(arrowSelect({ paths: ['a'], anchor: 'a' }, -1, false, order).paths).toEqual(['a'])
  expect(arrowSelect(none, 1, false, order).paths).toEqual(['a'])
})

it('visibleOrder lists rows as rendered, honouring open folders', () => {
  const folder: TreeNode = {
    name: 'f',
    relPath: 'f',
    kind: 'folder',
    children: [{ name: 'x.md', relPath: 'f/x.md', kind: 'file' }]
  }
  const file: TreeNode = { name: 'z.md', relPath: 'z.md', kind: 'file' }
  expect(visibleOrder([folder], [file], () => true)).toEqual(['f', 'f/x.md', 'z.md'])
  expect(visibleOrder([folder], [file], () => false)).toEqual(['f', 'z.md'])
})
