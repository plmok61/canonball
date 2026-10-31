// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { TreeNode } from '../../../shared/types'
import { ProseDialog } from './ProseDialog'

afterEach(cleanup)

const tree: TreeNode[] = [
  {
    name: 'drafts',
    relPath: 'drafts',
    kind: 'folder',
    children: [
      {
        name: 'chapters',
        relPath: 'drafts/chapters',
        kind: 'folder',
        children: [{ name: 'one.md', relPath: 'drafts/chapters/one.md', kind: 'file' }]
      }
    ]
  },
  { name: 'manuscript', relPath: 'manuscript', kind: 'folder', children: [] },
  { name: 'book.md', relPath: 'book.md', kind: 'file' }
]

it('lists folders at every depth and top-level files', () => {
  render(<ProseDialog tree={tree} initial={[]} onDone={vi.fn()} />)
  expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
  expect(screen.getByText('Which folders hold your prose?')).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: 'drafts' })).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: 'chapters' })).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: 'book' })).toBeInTheDocument()
  expect(screen.queryByRole('checkbox', { name: 'one' })).toBeNull()
})

it('Done returns the ticked paths', () => {
  const onDone = vi.fn()
  render(<ProseDialog tree={tree} initial={['drafts']} onDone={onDone} />)
  fireEvent.click(screen.getByRole('checkbox', { name: 'manuscript' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'drafts' }))
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  expect(onDone).toHaveBeenCalledWith(['manuscript'])
})

it('offers Cancel and Escape only when onCancel is given', () => {
  const onCancel = vi.fn()
  const { rerender } = render(<ProseDialog tree={tree} initial={[]} onDone={vi.fn()} />)
  expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(onCancel).not.toHaveBeenCalled()
  rerender(<ProseDialog tree={tree} initial={[]} onDone={vi.fn()} onCancel={onCancel} />)
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(onCancel).toHaveBeenCalledTimes(2)
})

it("keeps prose entries the dialog doesn't list", () => {
  const onDone = vi.fn()
  render(<ProseDialog tree={tree} initial={['drafts', 'drafts/ch1.md', 'gone']} onDone={onDone} />)
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  expect(onDone).toHaveBeenCalledWith(['drafts', 'drafts/ch1.md', 'gone'])
})

it('shows an error inside the dialog', () => {
  const { rerender } = render(<ProseDialog tree={tree} initial={[]} onDone={vi.fn()} />)
  expect(screen.queryByRole('alert')).toBeNull()
  rerender(<ProseDialog tree={tree} initial={[]} onDone={vi.fn()} error="disk full" />)
  expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('disk full')
})
