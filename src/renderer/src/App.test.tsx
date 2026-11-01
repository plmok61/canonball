// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import App from './App'
import { flushAll } from './editor/saveRegistry'

vi.mock('./editor/saveRegistry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./editor/saveRegistry')>()),
  flushAll: vi.fn()
}))

type MenuCommand = 'open-project' | 'new-project' | 'open-settings'
let menu: ((cmd: MenuCommand) => void) | null = null

const noAccess = {
  settings: { version: 1, prose: [], access: {} },
  needsProsePrompt: false,
  unreadable: false
}

function stub(
  lastProjectRoot: string | null,
  newProjectDialog: Mock = vi.fn()
): Record<
  | 'openProjectDialog'
  | 'newProjectDialog'
  | 'openProject'
  | 'setPathAccess'
  | 'getProjectAccess'
  | 'setProsePaths',
  Mock
> {
  const info = { root: '/p', name: 'p', tree: [], access: noAccess }
  const api = {
    getSettings: vi.fn().mockResolvedValue({ lastProjectRoot, theme: 'system' }),
    openProject: vi.fn().mockResolvedValue(info),
    openProjectDialog: vi.fn(),
    newProjectDialog,
    refreshTree: vi.fn().mockResolvedValue([]),
    getAiStatus: vi.fn().mockResolvedValue({
      keys: { anthropic: false, openai: false, google: false },
      localUrl: null,
      model: null,
      encryptionAvailable: true
    }),
    listModels: vi.fn().mockResolvedValue({ models: [], errors: [] }),
    listChats: vi.fn().mockResolvedValue([]),
    loadChat: vi.fn(),
    saveChat: vi.fn().mockResolvedValue(undefined),
    startChat: vi.fn().mockResolvedValue(undefined),
    cancelChat: vi.fn().mockResolvedValue(undefined),
    applyProposal: vi.fn(),
    rejectProposal: vi.fn().mockResolvedValue(undefined),
    onChatEvent: vi.fn(() => () => {}),
    getProjectAccess: vi.fn().mockResolvedValue(noAccess),
    setPathAccess: vi.fn().mockResolvedValue(noAccess),
    setProsePaths: vi.fn().mockResolvedValue(noAccess),
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
  const chat = screen.getByTestId('chat-panel')
  expect(within(chat).getByLabelText('Message')).toBeInTheDocument()
  expect(
    await within(chat).findByText('Add an AI connection in Settings to start chatting.')
  ).toBeInTheDocument()
})

it('the chat panel gear opens AI settings', async () => {
  stub('/p')
  render(<App />)
  const chat = await screen.findByTestId('chat-panel')
  fireEvent.click(within(chat).getByRole('button', { name: 'AI settings' }))
  expect(await screen.findByRole('dialog', { name: 'AI connections' })).toBeInTheDocument()
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

it('the settings menu command opens the dialog and does not create a project', async () => {
  const create = vi.fn()
  const api = stub(null, create)
  render(<App />)
  await screen.findByTestId('welcome')
  act(() => menu!('open-settings'))
  expect(await screen.findByRole('dialog', { name: 'AI connections' })).toBeInTheDocument()
  expect(create).not.toHaveBeenCalled()
  expect(api.openProjectDialog).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('Open Project from the menu awaits the flush before showing the dialog', async () => {
  const api = stub('/p')
  let finishFlush!: () => void
  vi.mocked(flushAll).mockReturnValue(new Promise<void>((r) => (finishFlush = r)))
  api.openProjectDialog.mockResolvedValue({
    root: '/q',
    name: 'q',
    tree: [{ name: 'other.md', relPath: 'other.md', kind: 'file' }],
    access: noAccess
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

const withCanon = (access: 'edit' | 'read'): typeof noAccess => ({
  ...noAccess,
  settings: { version: 1 as const, prose: [], access: { canon: access } }
})

const canonTree = [{ name: 'canon', relPath: 'canon', kind: 'folder' as const, children: [] }]

it('clicking a badge saves the next access', async () => {
  const api = stub('/p')
  api.openProject.mockResolvedValue({
    root: '/p',
    name: 'p',
    tree: canonTree,
    access: withCanon('edit')
  })
  api.setPathAccess.mockResolvedValue(withCanon('read'))
  render(<App />)
  const row = (await screen.findByText('canon')).closest('.cb-row')!
  expect(row.querySelector('.cb-badge')).toHaveTextContent('✎')
  fireEvent.click(row.querySelector('.cb-badge')!)
  await waitFor(() => expect(row.querySelector('.cb-badge')).toHaveTextContent('👁'))
  expect(api.setPathAccess).toHaveBeenCalledWith('/p', 'canon', 'read')
})

it('warns when project settings are unreadable', async () => {
  const api = stub('/p')
  api.openProject.mockResolvedValue({
    root: '/p',
    name: 'p',
    tree: [],
    access: { ...noAccess, unreadable: true }
  })
  render(<App />)
  expect(await screen.findByRole('alert')).toHaveTextContent(
    "Couldn't read .canonball/project.json. The AI can't see or change any files until it's fixed."
  )
})

function deferred<T>(): { promise: Promise<T>; resolve(v: T): void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const canonBadge = async (): Promise<HTMLElement> =>
  (await screen.findByText('canon')).closest('.cb-row')!.querySelector('.cb-badge') as HTMLElement

it('ignores a second badge click while a save is pending', async () => {
  const api = stub('/p')
  api.openProject.mockResolvedValue({
    root: '/p',
    name: 'p',
    tree: canonTree,
    access: withCanon('edit')
  })
  const save = deferred<typeof noAccess>()
  api.setPathAccess.mockReturnValue(save.promise)
  render(<App />)
  const b = await canonBadge()
  fireEvent.click(b)
  fireEvent.click(b)
  expect(api.setPathAccess).toHaveBeenCalledTimes(1)
  await act(async () => save.resolve(withCanon('read')))
  await waitFor(() => expect(b).toHaveTextContent('👁'))
})

it("discards an old project's focus-refresh access after a switch", async () => {
  const api = stub('/p')
  api.openProject.mockResolvedValue({
    root: '/p',
    name: 'p',
    tree: canonTree,
    access: withCanon('edit')
  })
  const late = deferred<typeof noAccess>()
  api.getProjectAccess.mockReturnValue(late.promise)
  api.openProjectDialog.mockResolvedValue({
    root: '/q',
    name: 'q',
    tree: canonTree,
    access: withCanon('read')
  })
  render(<App />)
  await canonBadge()
  act(() => {
    window.dispatchEvent(new Event('focus'))
  })
  act(() => menu!('open-project'))
  await waitFor(() => expect(api.openProjectDialog).toHaveBeenCalled())
  await waitFor(async () => expect(await canonBadge()).toHaveTextContent('👁'))
  await act(async () => late.resolve(withCanon('edit')))
  expect(await canonBadge()).toHaveTextContent('👁')
})

it("shows the new project's access after a switch", async () => {
  const api = stub('/p')
  api.openProject.mockResolvedValue({
    root: '/p',
    name: 'p',
    tree: canonTree,
    access: withCanon('edit')
  })
  api.setPathAccess.mockResolvedValue(withCanon('read'))
  api.openProjectDialog.mockResolvedValue({
    root: '/q',
    name: 'q',
    tree: canonTree,
    access: withCanon('edit')
  })
  render(<App />)
  fireEvent.click(await canonBadge())
  await waitFor(async () => expect(await canonBadge()).toHaveTextContent('👁'))
  act(() => menu!('open-project'))
  await waitFor(async () => expect(await canonBadge()).toHaveTextContent('✎'))
})

const draftsTree = [
  {
    name: 'drafts',
    relPath: 'drafts',
    kind: 'folder' as const,
    children: [] as never[]
  }
]

it('asks which folders hold prose when the project has no settings', async () => {
  const api = stub('/p')
  const prompt = { ...noAccess, needsProsePrompt: true }
  api.openProject.mockResolvedValue({ root: '/p', name: 'p', tree: draftsTree, access: prompt })
  api.setProsePaths.mockResolvedValue({
    ...noAccess,
    settings: { version: 1, prose: ['drafts'], access: {} }
  })
  render(<App />)
  expect(await screen.findByRole('dialog')).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: 'drafts' })).toBeChecked()
  expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  await waitFor(() => expect(api.setProsePaths).toHaveBeenCalledWith('/p', ['drafts']))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

it('does not ask when settings exist', async () => {
  stub('/p')
  render(<App />)
  await screen.findByTestId('tree-panel')
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('Prose folders… reopens the dialog', async () => {
  const api = stub('/p')
  const access = { ...noAccess, settings: { version: 1, prose: ['drafts'], access: {} } }
  api.openProject.mockResolvedValue({ root: '/p', name: 'p', tree: draftsTree, access })
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'Prose folders…' }))
  expect(screen.getByRole('checkbox', { name: 'drafts' })).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(api.setProsePaths).not.toHaveBeenCalled()
})

it('keeps the dialog open and shows the error inside it when saving prose folders fails', async () => {
  const api = stub('/p')
  api.openProject.mockResolvedValue({
    root: '/p',
    name: 'p',
    tree: draftsTree,
    access: { ...noAccess, needsProsePrompt: true }
  })
  api.setProsePaths.mockRejectedValueOnce(new Error('disk full'))
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'Done' }))
  const dialog = screen.getByRole('dialog')
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('disk full')
  expect(screen.getAllByText('disk full')).toHaveLength(1)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled())
  const retry = deferred<typeof noAccess>()
  api.setProsePaths.mockReturnValueOnce(retry.promise)
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  expect(within(dialog).queryByRole('alert')).toBeNull()
  await act(async () => retry.resolve(noAccess))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.queryByRole('alert')).toBeNull()
})

it('a successful badge cycle clears the previous error', async () => {
  const api = stub('/p')
  api.openProject.mockResolvedValue({
    root: '/p',
    name: 'p',
    tree: canonTree,
    access: withCanon('edit')
  })
  api.setPathAccess.mockRejectedValueOnce(new Error('disk full'))
  api.setPathAccess.mockResolvedValueOnce(withCanon('read'))
  render(<App />)
  const b = await canonBadge()
  fireEvent.click(b)
  expect(await screen.findByRole('alert')).toHaveTextContent('disk full')
  fireEvent.click(b)
  await waitFor(() => expect(b).toHaveTextContent('👁'))
  expect(screen.queryByRole('alert')).toBeNull()
})

it('hides Prose folders… when settings are unreadable', async () => {
  const api = stub('/p')
  api.openProject.mockResolvedValue({
    root: '/p',
    name: 'p',
    tree: [],
    access: { ...noAccess, unreadable: true }
  })
  render(<App />)
  await screen.findByTestId('tree-panel')
  expect(screen.queryByRole('button', { name: 'Prose folders…' })).toBeNull()
})

it("doesn't write when the prose list is unchanged, even with unlisted entries", async () => {
  const api = stub('/p')
  const access = {
    ...noAccess,
    settings: { version: 1, prose: ['drafts', 'drafts/ch1.md'], access: {} }
  }
  api.openProject.mockResolvedValue({ root: '/p', name: 'p', tree: draftsTree, access })
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'Prose folders…' }))
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(api.setProsePaths).not.toHaveBeenCalled()
})

it('an accepted change refreshes the tree and reloads the open file', async () => {
  // jsdom lacks the layout APIs ProseMirror probes.
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  Range.prototype.getClientRects = () =>
    ({
      length: 0,
      item: () => null,
      [Symbol.iterator]: [][Symbol.iterator]
    }) as unknown as DOMRectList
  document.elementFromPoint = () => null

  const api = stub('/p')
  const notesTree = [
    {
      name: 'notes',
      relPath: 'notes',
      kind: 'folder' as const,
      children: [{ name: 'ideas.md', relPath: 'notes/ideas.md', kind: 'file' as const }]
    }
  ]
  api.openProject.mockResolvedValue({ root: '/p', name: 'p', tree: notesTree, access: noAccess })
  const thread = {
    version: 1,
    id: '33333333-3333-4333-8333-333333333333',
    title: 'Notes',
    createdAt: '2026-10-31T00:00:00.000Z',
    updatedAt: '2026-10-31T00:00:00.000Z',
    messages: [
      { role: 'user', content: 'tidy', at: '2026-10-31T00:00:00.000Z' },
      {
        role: 'assistant',
        content: 'Here.',
        at: '2026-10-31T00:00:01.000Z',
        proposals: [
          {
            id: '44444444-4444-4444-8444-444444444444',
            kind: 'edit',
            relPath: 'notes/ideas.md',
            before: 'old idea\n',
            after: 'new idea\n',
            status: 'pending'
          }
        ]
      }
    ]
  }
  const more = window.canonball as unknown as Record<string, Mock>
  more.listChats.mockResolvedValue([
    { id: thread.id, title: thread.title, updatedAt: thread.updatedAt }
  ])
  more.loadChat.mockResolvedValue(thread)
  more.applyProposal.mockResolvedValue({ relPath: 'notes/ideas.md' })
  Object.assign(more, {
    readDoc: vi.fn().mockResolvedValue({ content: 'old idea\n', mtimeMs: 1 }),
    writeDoc: vi.fn(),
    onFlushRequest: vi.fn(),
    lintGrammar: vi.fn(async (texts: string[]) => texts.map(() => []))
  })

  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'ideas' }))
  const page = screen.getByTestId('editor-panel')
  await waitFor(() => expect(page.querySelector('.ProseMirror')).toHaveTextContent('old idea'))
  const refreshesBefore = more.refreshTree.mock.calls.length

  more.readDoc.mockResolvedValue({ content: 'new idea\n', mtimeMs: 2 })
  const chat = screen.getByTestId('chat-panel')
  fireEvent.click(await within(chat).findByRole('button', { name: 'Accept' }))
  await waitFor(() => expect(page.querySelector('.ProseMirror')).toHaveTextContent('new idea'))
  expect(more.refreshTree.mock.calls.length).toBeGreaterThan(refreshesBefore)
  expect(more.writeDoc).not.toHaveBeenCalled()
})
