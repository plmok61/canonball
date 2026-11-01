// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { TreeNode } from '../../../shared/types'
import { ProtectDialog } from './ProtectDialog'

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
  render(<ProtectDialog tree={tree} initial={[]} onDone={vi.fn()} />)
  expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
  expect(screen.getByRole('checkbox', { name: 'drafts' })).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: 'chapters' })).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: 'book' })).toBeInTheDocument()
  expect(screen.queryByRole('checkbox', { name: 'one' })).toBeNull()
})

it('Done returns the ticked paths', () => {
  const onDone = vi.fn()
  render(<ProtectDialog tree={tree} initial={['drafts']} onDone={onDone} />)
  fireEvent.click(screen.getByRole('checkbox', { name: 'manuscript' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'drafts' }))
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  expect(onDone).toHaveBeenCalledWith(['manuscript'])
})

it('offers Cancel and Escape only when onCancel is given', () => {
  const onCancel = vi.fn()
  const { rerender } = render(<ProtectDialog tree={tree} initial={[]} onDone={vi.fn()} />)
  expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(onCancel).not.toHaveBeenCalled()
  rerender(<ProtectDialog tree={tree} initial={[]} onDone={vi.fn()} onCancel={onCancel} />)
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(onCancel).toHaveBeenCalledTimes(2)
})

it("keeps protected entries the dialog doesn't list", () => {
  const onDone = vi.fn()
  render(
    <ProtectDialog tree={tree} initial={['drafts', 'drafts/ch1.md', 'gone']} onDone={onDone} />
  )
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  expect(onDone).toHaveBeenCalledWith(['drafts', 'drafts/ch1.md', 'gone'])
})

it('shows an error inside the dialog', () => {
  const { rerender } = render(<ProtectDialog tree={tree} initial={[]} onDone={vi.fn()} />)
  expect(screen.queryByRole('alert')).toBeNull()
  rerender(<ProtectDialog tree={tree} initial={[]} onDone={vi.fn()} error="disk full" />)
  expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('disk full')
})

it('asks which folders the AI should never edit', () => {
  render(<ProtectDialog tree={tree} initial={[]} onDone={vi.fn()} />)
  expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(
    'Which folders should the AI never edit?'
  )
  expect(screen.getByRole('dialog')).toHaveAttribute('aria-labelledby', 'cb-protect-title')
  expect(screen.getByText(/^Usually your drafts/).textContent).toBe(
    'Usually your drafts or chapters. The AI can still read them to answer questions. You can change this later by right-clicking a folder.'
  )
})
