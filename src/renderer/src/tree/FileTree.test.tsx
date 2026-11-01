// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import {
  act,
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  within
} from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { Move, TreeNode } from '../../../shared/types'
import { FileTree, type EditingState } from './FileTree'
import type { DragHandlers } from './dragDrop'
import type { Selection } from './selection'

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
  protectedPaths: [] as string[],
  selection: { paths: [], anchor: null } as Selection,
  onSelect: vi.fn(),
  onMenu: vi.fn(),
  onKey: vi.fn(),
  onFocusChange: vi.fn(),
  cutPaths: [] as string[],
  editing: null as EditingState,
  onEditSubmit: vi.fn().mockResolvedValue(null),
  onEditCancel: vi.fn(),
  moves: [] as Move[],
  drag: undefined as unknown as DragHandlers
}

afterEach(cleanup)

it('shows names without .md', () => {
  render(<FileTree {...base} />)
  expect(screen.getByText('characters')).toBeInTheDocument()
  expect(screen.getByText('README')).toBeInTheDocument()
  expect(screen.queryByText('README.md')).toBeNull()
})

it('clicking a file selects it and opens it', () => {
  const onSelect = vi.fn()
  render(
    <FileTree
      {...base}
      selection={{ paths: ['README.md'], anchor: 'README.md' }}
      onSelect={onSelect}
    />
  )
  fireEvent.click(screen.getByText('characters'))
  expect(onSelect).toHaveBeenCalledWith(
    { paths: ['canon/characters.md'], anchor: 'canon/characters.md' },
    'canon/characters.md'
  )
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

it('right-click calls onMenu with the row and whether it is a protected root', () => {
  const onMenu = vi.fn()
  render(
    <FileTree
      {...withDrafts}
      tree={[...withDrafts.tree, { name: 'notes', relPath: 'notes', kind: 'folder', children: [] }]}
      onMenu={onMenu}
    />
  )
  fireEvent.contextMenu(within(projectRegion()).getByText('notes'))
  expect(onMenu).toHaveBeenLastCalledWith({ relPath: 'notes', inProtectedRoot: false })
  fireEvent.contextMenu(within(protectedRegion()).getByText('drafts'))
  expect(onMenu).toHaveBeenLastCalledWith({ relPath: 'drafts', inProtectedRoot: true })
  fireEvent.contextMenu(within(protectedRegion()).getByText('ch1'))
  expect(onMenu).toHaveBeenLastCalledWith({ relPath: 'drafts/ch1.md', inProtectedRoot: false })
  expect(onMenu).toHaveBeenCalledTimes(3)
})

it('right-click on empty space calls onMenu with a null path', () => {
  const onMenu = vi.fn()
  render(<FileTree {...base} onMenu={onMenu} />)
  fireEvent.contextMenu(screen.getByRole('group', { name: 'Files' }))
  expect(onMenu).toHaveBeenCalledWith({ relPath: null, inProtectedRoot: false })
})

it('files open from Protected', () => {
  const onSelect = vi.fn()
  render(<FileTree {...withDrafts} onSelect={onSelect} />)
  fireEvent.click(within(protectedRegion()).getByText('ch1'))
  expect(onSelect).toHaveBeenCalledWith(expect.anything(), 'drafts/ch1.md')
})

it('cmd-click selects without opening', () => {
  const onSelect = vi.fn()
  render(<FileTree {...base} onSelect={onSelect} />)
  fireEvent.click(screen.getByText('README'), { metaKey: true })
  expect(onSelect).toHaveBeenCalledWith({ paths: ['README.md'], anchor: 'README.md' }, undefined)
})

it('cut rows are faded and selected rows marked', () => {
  const { container } = render(
    <FileTree
      {...base}
      cutPaths={['README.md']}
      selection={{ paths: ['README.md'], anchor: 'README.md' }}
    />
  )
  const row = screen.getByText('README').closest('.cb-row')
  expect(row).toHaveClass('cb-row-cut')
  expect(row).toHaveClass('cb-row-selected')
  expect(container.querySelectorAll('.cb-row-cut')).toHaveLength(1)
})

it('expanded folders stay expanded after a rename', () => {
  const mk = (top: string): TreeNode[] => [
    {
      name: top,
      relPath: top,
      kind: 'folder',
      children: [
        {
          name: 'ch',
          relPath: `${top}/ch`,
          kind: 'folder',
          children: [{ name: 'x.md', relPath: `${top}/ch/x.md`, kind: 'file' }]
        }
      ]
    }
  ]
  const { rerender } = render(<FileTree {...base} tree={mk('book')} />)
  fireEvent.click(screen.getByText('ch'))
  expect(screen.getByText('x')).toBeInTheDocument()
  rerender(<FileTree {...base} tree={mk('novel')} moves={[{ from: 'book', to: 'novel' }]} />)
  expect(screen.getByText('novel')).toBeInTheDocument()
  expect(screen.getByText('x')).toBeInTheDocument()
})

it('expand opens folders, nested or top-level', () => {
  const nested: TreeNode[] = [
    {
      name: 'book',
      relPath: 'book',
      kind: 'folder',
      children: [
        {
          name: 'ch',
          relPath: 'book/ch',
          kind: 'folder',
          children: [{ name: 'x.md', relPath: 'book/ch/x.md', kind: 'file' }]
        }
      ]
    }
  ]
  const { rerender } = render(<FileTree {...base} tree={nested} />)
  expect(screen.queryByText('x')).toBeNull()
  rerender(<FileTree {...base} tree={nested} expand={['book/ch']} />)
  expect(screen.getByText('x')).toBeInTheDocument()
  fireEvent.click(screen.getByText('book'))
  expect(screen.queryByText('ch')).toBeNull()
  rerender(<FileTree {...base} tree={nested} expand={['book']} />)
  expect(screen.getByText('ch')).toBeInTheDocument()
})

it('rows carry their path', () => {
  render(<FileTree {...base} />)
  expect(screen.getByText('characters').closest('[role="treeitem"]')).toHaveAttribute(
    'data-path',
    'canon/characters.md'
  )
})

it('focusing and blurring the tree reports focus', () => {
  const onFocusChange = vi.fn()
  render(<FileTree {...base} onFocusChange={onFocusChange} />)
  const el = screen.getByRole('group', { name: 'Files' })
  fireEvent.focus(el)
  expect(onFocusChange).toHaveBeenLastCalledWith(true)
  fireEvent.blur(el)
  expect(onFocusChange).toHaveBeenLastCalledWith(false)
})

it('renders a name box for a new entry at the top of its folder', () => {
  render(<FileTree {...base} editing={{ mode: 'new', kind: 'file', parentRel: 'canon' }} />)
  const input = screen.getByRole('textbox')
  expect(input.closest('[role="group"]')?.firstElementChild).toContainElement(input)
})

it('renders a name box in place of the row being renamed', () => {
  render(<FileTree {...base} editing={{ mode: 'rename', relPath: 'README.md' }} />)
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('README')
  expect(screen.queryByText('README')).toBeNull()
})

it('shows no access badges or legend', () => {
  const { container } = render(<FileTree {...base} />)
  expect(container.querySelector('.cb-badge')).toBeNull()
  expect(screen.queryByRole('list', { name: 'AI access' })).toBeNull()
  expect(container.textContent).not.toMatch(/[✎👁⊘]/u)
})

const dt = (): { dataTransfer: Record<string, unknown> } => ({
  dataTransfer: {
    types: ['application/x-canonball-paths'],
    setData: vi.fn(),
    effectAllowed: '',
    dropEffect: ''
  }
})

const dragHandlers = (allow = true): DragHandlers => ({
  onDragStart: vi.fn(),
  onDragOver: vi.fn().mockReturnValue(allow),
  onDrop: vi.fn(),
  onDragEnd: vi.fn()
})

const rowOf = (name: string): Element => screen.getByText(name).closest('.cb-row')!

it('rows are draggable and report the drag start', () => {
  const drag = dragHandlers()
  render(<FileTree {...base} drag={drag} />)
  expect(rowOf('README')).toHaveAttribute('draggable', 'true')
  fireEvent.dragStart(rowOf('README'), dt())
  expect(drag.onDragStart).toHaveBeenCalledWith('README.md')
})

it('rows are not draggable while a name box is open', () => {
  render(
    <FileTree
      {...base}
      drag={dragHandlers()}
      editing={{ mode: 'new', kind: 'file', parentRel: '' }}
    />
  )
  expect(rowOf('README')).toHaveAttribute('draggable', 'false')
})

it('highlights an allowed row under the pointer and drops with the option key', () => {
  const drag = dragHandlers()
  render(<FileTree {...base} drag={drag} />)
  const row = rowOf('canon')
  fireEvent.dragOver(row, dt())
  expect(row).toHaveClass('cb-row-drop')
  expect(drag.onDragOver).toHaveBeenCalledWith({ relPath: 'canon', kind: 'folder' })
  const ev = createEvent.drop(row, dt())
  Object.defineProperty(ev, 'altKey', { value: true })
  fireEvent(row, ev)
  expect(drag.onDrop).toHaveBeenCalledWith({ relPath: 'canon', kind: 'folder' }, true)
  expect(row).not.toHaveClass('cb-row-drop')
})

it('does not highlight a refused row', () => {
  render(<FileTree {...base} drag={dragHandlers(false)} />)
  fireEvent.dragOver(rowOf('canon'), dt())
  expect(rowOf('canon')).not.toHaveClass('cb-row-drop')
})

it('empty space is the top-level target', () => {
  const drag = dragHandlers()
  render(<FileTree {...base} drag={drag} />)
  fireEvent.drop(screen.getByRole('tree', { name: 'Project files' }).parentElement!, dt())
  expect(drag.onDrop).toHaveBeenCalledWith({ relPath: null, kind: null }, false)
})

it('ignores drags that lack the internal type', () => {
  const drag = dragHandlers()
  render(<FileTree {...base} drag={drag} />)
  fireEvent.drop(rowOf('canon'), { dataTransfer: { types: ['Files'] } })
  expect(drag.onDrop).not.toHaveBeenCalled()
})

it('a folder hovered for a second expands; leaving cancels', () => {
  vi.useFakeTimers()
  try {
    const drag = dragHandlers()
    render(<FileTree {...base} drag={drag} />)
    // top-level folders start open; fold canon first
    fireEvent.click(screen.getByRole('button', { name: 'canon' }))
    expect(screen.queryByText('characters')).toBeNull()
    fireEvent.dragOver(rowOf('canon'), dt())
    act(() => void vi.advanceTimersByTime(500))
    fireEvent.dragLeave(rowOf('canon'), dt())
    act(() => void vi.advanceTimersByTime(1000))
    expect(screen.queryByText('characters')).toBeNull()
    fireEvent.dragOver(rowOf('canon'), dt())
    act(() => void vi.advanceTimersByTime(1000))
    expect(screen.getByText('characters')).toBeInTheDocument()
  } finally {
    vi.useRealTimers()
  }
})
