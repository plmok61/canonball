// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import App from './App'
import { flushAll } from './editor/saveRegistry'

vi.mock('./editor/saveRegistry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./editor/saveRegistry')>()),
  flushAll: vi.fn()
}))

type MenuCommand = 'open-project' | 'new-project'
let menu: ((cmd: MenuCommand) => void) | null = null

function stub(
  lastProjectRoot: string | null,
  newProjectDialog: Mock = vi.fn()
): Record<'openProjectDialog' | 'newProjectDialog', Mock> {
  const info = { root: '/p', name: 'p', tree: [] }
  const api = {
    getSettings: vi.fn().mockResolvedValue({ lastProjectRoot, theme: 'system' }),
    openProject: vi.fn().mockResolvedValue(info),
    openProjectDialog: vi.fn(),
    newProjectDialog,
    refreshTree: vi.fn().mockResolvedValue([]),
    onMenuCommand: vi.fn((handler: (cmd: MenuCommand) => void) => {
      menu = handler
      return () => {
        if (menu === handler) menu = null
      }
    })
  }
  ;(window as unknown as { canonball: object }).canonball = api
  return api
}

beforeEach(() => {
  vi.mocked(flushAll).mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  menu = null
})

it('renders tree, editor and chat panels', async () => {
  stub('/p')
  render(<App />)
  expect(await screen.findByTestId('tree-panel')).toBeInTheDocument()
  expect(screen.getByTestId('editor-panel')).toBeInTheDocument()
  expect(screen.getByTestId('chat-panel')).toHaveTextContent('AI chat arrives in a later phase')
})

it('shows welcome screen when no last project', async () => {
  stub(null)
  render(<App />)
  expect(await screen.findByRole('button', { name: 'Open Project…' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'New Project…' })).toBeInTheDocument()
  expect(screen.queryByTestId('tree-panel')).toBeNull()
})

it('shows an error when creating a project fails', async () => {
  stub(null, vi.fn().mockRejectedValue(new Error('Folder is not empty')))
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'New Project…' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Folder is not empty')
  expect(screen.getByRole('button', { name: 'New Project…' })).toBeEnabled()
})

it('Open Project from the menu awaits the flush before showing the dialog', async () => {
  const api = stub('/p')
  let finishFlush!: () => void
  vi.mocked(flushAll).mockReturnValue(new Promise<void>((r) => (finishFlush = r)))
  api.openProjectDialog.mockResolvedValue({
    root: '/q',
    name: 'q',
    tree: [{ name: 'other.md', relPath: 'other.md', kind: 'file' }]
  })
  render(<App />)
  await screen.findByTestId('tree-panel')
  act(() => menu!('open-project'))
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10))
  })
  expect(flushAll).toHaveBeenCalled()
  expect(api.openProjectDialog).not.toHaveBeenCalled()
  await act(async () => finishFlush())
  await waitFor(() => expect(api.openProjectDialog).toHaveBeenCalledTimes(1))
  expect(await screen.findByRole('treeitem', { name: /other/ })).toBeInTheDocument()
})

it('New Project from the menu does not switch when the flush fails', async () => {
  const api = stub('/p')
  vi.mocked(flushAll).mockRejectedValue(new Error('disk full'))
  render(<App />)
  await screen.findByTestId('tree-panel')
  act(() => menu!('new-project'))
  expect(await screen.findByRole('alert')).toHaveTextContent('disk full')
  expect(api.newProjectDialog).not.toHaveBeenCalled()
  expect(screen.getByTestId('tree-panel')).toBeInTheDocument()
})
