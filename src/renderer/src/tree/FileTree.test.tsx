// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { TreeNode } from '../../../shared/types'
import { FileTree } from './FileTree'
import { DEFAULT_PROJECT_SETTINGS } from '../../../shared/access'

const tree: TreeNode[] = [
  {
    name: 'canon',
    relPath: 'canon',
    kind: 'folder',
    children: [{ name: 'characters.md', relPath: 'canon/characters.md', kind: 'file' }]
  },
  { name: 'README.md', relPath: 'README.md', kind: 'file' }
]

const base = {
  tree: [
    ...tree,
    {
      name: 'drafts',
      relPath: 'drafts',
      kind: 'folder' as const,
      children: [{ name: 'ch1.md', relPath: 'drafts/ch1.md', kind: 'file' as const }]
    }
  ],
  selected: null,
  onOpen: vi.fn(),
  settings: DEFAULT_PROJECT_SETTINGS,
  onCycle: vi.fn()
}

afterEach(cleanup)

it('shows names without .md', () => {
  render(<FileTree {...base} />)
  expect(screen.getByText('characters')).toBeInTheDocument()
  expect(screen.getByText('README')).toBeInTheDocument()
  expect(screen.queryByText('README.md')).toBeNull()
})

it('clicking a file calls onOpen with relPath', () => {
  const onOpen = vi.fn()
  render(<FileTree {...base} selected="README.md" onOpen={onOpen} />)
  fireEvent.click(screen.getByText('characters'))
  expect(onOpen).toHaveBeenCalledWith('canon/characters.md')
  expect(screen.getByText('README').closest('[role="treeitem"]')).toHaveAttribute(
    'aria-selected',
    'true'
  )
})

it('clicking a folder collapses it', () => {
  render(<FileTree {...base} />)
  fireEvent.click(screen.getByText('canon'))
  expect(screen.queryByText('characters')).toBeNull()
  fireEvent.click(screen.getByText('canon'))
  expect(screen.getByText('characters')).toBeInTheDocument()
})

const badge = (label: string, i = 0): HTMLElement =>
  screen.getAllByRole('button', { name: `${label}. Click to change.` })[i]

it("shows each row's effective badge", () => {
  render(<FileTree {...base} />)
  const canon = screen.getByText('canon').closest('.cb-row')!
  expect(canon.querySelector('.cb-badge')).toHaveTextContent('✎')
  expect(canon.querySelector('.cb-badge')).toHaveAttribute('title', 'AI can read and edit')
  expect(canon.querySelector('.cb-badge')).not.toHaveClass('cb-badge-inherited')
  const drafts = screen.getByText('drafts').closest('.cb-row')!
  expect(drafts.querySelector('.cb-badge')).toHaveTextContent('👁')
  const file = screen.getByText('characters').closest('.cb-row')!
  expect(file.querySelector('.cb-badge')).toHaveTextContent('✎')
  expect(file.querySelector('.cb-badge')).toHaveClass('cb-badge-inherited')
})

it('clicking a badge cycles without opening the file', () => {
  const onCycle = vi.fn()
  const onOpen = vi.fn()
  render(<FileTree {...base} onCycle={onCycle} onOpen={onOpen} />)
  fireEvent.click(screen.getByText('characters').closest('.cb-row')!.querySelector('.cb-badge')!)
  expect(onCycle).toHaveBeenCalledWith('canon/characters.md')
  expect(onOpen).not.toHaveBeenCalled()
  expect(badge('AI can read and edit')).toBeInTheDocument()
})

it('prose rows are tagged', () => {
  render(<FileTree {...base} />)
  expect(screen.getByText('drafts').closest('.cb-row')).toContainElement(
    screen.getAllByText('prose')[0]
  )
  expect(screen.getByText('canon').closest('.cb-row')!.querySelector('.cb-prose-tag')).toBeNull()
})

it('the legend lists all three badges', () => {
  render(<FileTree {...base} />)
  const legend = screen.getByRole('list', { name: 'AI access' })
  expect(legend).toHaveTextContent('✎ AI can read and edit')
  expect(legend).toHaveTextContent('👁 AI can read only')
  expect(legend).toHaveTextContent("⊘ AI can't see it")
})
