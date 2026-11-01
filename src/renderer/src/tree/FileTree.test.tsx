// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { TreeNode } from '../../../shared/types'
import { FileTree } from './FileTree'

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
  protectedPaths: [] as string[],
  onRowMenu: vi.fn()
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

const withDrafts = { ...base, protectedPaths: ['drafts'] }
const protectedRegion = (): HTMLElement => screen.getByRole('region', { name: 'Protected' })
const projectRegion = (): HTMLElement => screen.getByRole('region', { name: 'Project' })

it('protected items appear only in the Protected section', () => {
  render(<FileTree {...withDrafts} />)
  expect(within(protectedRegion()).getByText('drafts')).toBeInTheDocument()
  expect(within(projectRegion()).queryByText('drafts')).toBeNull()
  expect(within(projectRegion()).getByText('canon')).toBeInTheDocument()
})

it('shows the hint when nothing is protected', () => {
  render(<FileTree {...base} />)
  expect(
    within(protectedRegion()).getByText('Right-click a folder or file to protect it from AI edits.')
  ).toBeInTheDocument()
})

it('shows the caption', () => {
  render(<FileTree {...withDrafts} />)
  expect(screen.getByText('AI can read, never edit')).toBeInTheDocument()
  expect(
    within(protectedRegion()).queryByText(
      'Right-click a folder or file to protect it from AI edits.'
    )
  ).toBeNull()
})

it('a nested root shows its parent path', () => {
  const nested: TreeNode[] = [
    {
      name: 'book',
      relPath: 'book',
      kind: 'folder',
      children: [{ name: 'ch', relPath: 'book/ch', kind: 'folder', children: [] }]
    }
  ]
  render(<FileTree {...base} tree={nested} protectedPaths={['book/ch']} />)
  const parent = within(protectedRegion()).getByText('book')
  expect(parent).toHaveClass('cb-row-parent')
  expect(parent.nextElementSibling).toHaveTextContent('ch')
})

it('right-click calls onRowMenu', () => {
  const onRowMenu = vi.fn()
  render(
    <FileTree
      {...withDrafts}
      tree={[...withDrafts.tree, { name: 'notes', relPath: 'notes', kind: 'folder', children: [] }]}
      onRowMenu={onRowMenu}
    />
  )
  fireEvent.contextMenu(within(projectRegion()).getByText('notes'))
  expect(onRowMenu).toHaveBeenLastCalledWith('notes', false)
  fireEvent.contextMenu(within(protectedRegion()).getByText('drafts'))
  expect(onRowMenu).toHaveBeenLastCalledWith('drafts', true)
  onRowMenu.mockClear()
  fireEvent.contextMenu(within(protectedRegion()).getByText('ch1'))
  expect(onRowMenu).not.toHaveBeenCalled()
})

it('files open from Protected', () => {
  const onOpen = vi.fn()
  render(<FileTree {...withDrafts} onOpen={onOpen} />)
  fireEvent.click(within(protectedRegion()).getByText('ch1'))
  expect(onOpen).toHaveBeenCalledWith('drafts/ch1.md')
})

it('shows no access badges or legend', () => {
  const { container } = render(<FileTree {...base} />)
  expect(container.querySelector('.cb-badge')).toBeNull()
  expect(screen.queryByRole('list', { name: 'AI access' })).toBeNull()
  expect(container.textContent).not.toMatch(/[✎👁⊘]/u)
})
