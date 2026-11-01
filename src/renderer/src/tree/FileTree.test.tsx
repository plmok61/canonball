// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { TreeNode } from '../../../shared/types'
import { FileTree } from './FileTree'
import { DEFAULT_PROJECT_SETTINGS } from '../../../shared/protection'

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
  settings: DEFAULT_PROJECT_SETTINGS
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

it('protected rows are tagged', () => {
  render(<FileTree {...base} />)
  expect(screen.getByText('drafts').closest('.cb-row')).toContainElement(
    screen.getAllByText('protected')[0]
  )
  expect(
    screen.getByText('canon').closest('.cb-row')!.querySelector('.cb-protected-tag')
  ).toBeNull()
})

it('shows no access badges or legend', () => {
  const { container } = render(<FileTree {...base} />)
  expect(container.querySelector('.cb-badge')).toBeNull()
  expect(screen.queryByRole('list', { name: 'AI access' })).toBeNull()
  expect(container.textContent).not.toMatch(/[✎👁⊘]/u)
})
