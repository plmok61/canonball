// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest'
import {
  act,
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import App from './App'
import { flushAll } from './editor/saveRegistry'
import { menuFor } from '../../shared/treeMenuItems'

vi.mock('./editor/saveRegistry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./editor/saveRegistry')>()),
  flushAll: vi.fn()
}))

import type { MenuCommand } from '../../shared/types'
let menu: ((cmd: MenuCommand) => void) | null = null

const noProtection = {
  settings: { version: 2 as const, protected: [] as string[] },
  needsProtectPrompt: false,
  unreadable: false
}

function stub(
  lastProjectRoot: string | null,
  newProjectDialog: Mock = vi.fn()
): Record<
  | 'openProjectDialog'
  | 'newProjectDialog'
  | 'openProject'
  | 'getProjectProtection'
  | 'setProtectedPaths'
  | 'changeProtectionMany'
  | 'showTreeMenu'
  | 'createEntry'
  | 'renameEntry'
  | 'pasteEntries'
  | 'duplicateEntries'
  | 'moveExact'
  | 'nativeUndo'
  | 'nativeRedo'
  | 'trashEntries'
  | 'restoreEntries'
  | 'removeCreated'
  | 'applyProtectionDelta'
  | 'revealEntry'
  | 'confirmDialog'
  | 'refreshTree',
  Mock
> {
  const info = { root: '/p', name: 'p', tree: [], protection: noProtection }
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
    getProjectProtection: vi.fn().mockResolvedValue(noProtection),
    setProtectedPaths: vi.fn().mockResolvedValue(noProtection),
    changeProtectionMany: vi
      .fn()
      .mockResolvedValue({ protection: noProtection, delta: { added: [], removed: [] } }),
    showTreeMenu: vi.fn().mockResolvedValue(null),
    confirmDialog: vi.fn().mockResolvedValue(true),
    createEntry: vi.fn(),
    renameEntry: vi.fn(),
    pasteEntries: vi.fn(),
    duplicateEntries: vi.fn(),
    moveExact: vi.fn(),
    nativeUndo: vi.fn(),
    nativeRedo: vi.fn(),
    trashEntries: vi.fn(),
    restoreEntries: vi.fn(),
    removeCreated: vi.fn(),
    applyProtectionDelta: vi.fn(),
    revealEntry: vi.fn().mockResolvedValue(undefined),
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
    protection: noProtection
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

const withCanon = (isProtected: boolean): typeof noProtection => ({
  ...noProtection,
  settings: { version: 2 as const, protected: isProtected ? ['canon'] : [] }
})

const canonTree = [{ name: 'canon', relPath: 'canon', kind: 'folder' as const, children: [] }]

it('warns when project settings are unreadable', async () => {
  const api = stub('/p')
  api.openProject.mockResolvedValue({
    root: '/p',
    name: 'p',
    tree: [],
    protection: { ...noProtection, unreadable: true }
  })
  render(<App />)
  expect(await screen.findByRole('alert')).toHaveTextContent(
    "Couldn't read .canonball/project.json. The AI can't change any files until it's fixed."
  )
})

function deferred<T>(): { promise: Promise<T>; resolve(v: T): void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const canonTag = async (): Promise<HTMLElement | null> =>
  within(await screen.findByRole('region', { name: 'Protected' })).queryByText('canon')

it("discards an old project's focus-refresh protection after a switch", async () => {
  const api = stub('/p')
  api.openProject.mockResolvedValue({
    root: '/p',
    name: 'p',
    tree: canonTree,
    protection: withCanon(false)
  })
  const late = deferred<typeof noProtection>()
  api.getProjectProtection.mockReturnValue(late.promise)
  api.openProjectDialog.mockResolvedValue({
    root: '/q',
    name: 'q',
    tree: canonTree,
    protection: withCanon(true)
  })
  render(<App />)
  expect(await canonTag()).toBeNull()
  act(() => {
    window.dispatchEvent(new Event('focus'))
  })
  act(() => menu!('open-project'))
  await waitFor(() => expect(api.openProjectDialog).toHaveBeenCalled())
  await waitFor(async () => expect(await canonTag()).not.toBeNull())
  await act(async () => late.resolve(withCanon(false)))
  expect(await canonTag()).not.toBeNull()
})

it("shows the new project's protection after a switch", async () => {
  const api = stub('/p')
  api.openProject.mockResolvedValue({
    root: '/p',
    name: 'p',
    tree: canonTree,
    protection: { ...withCanon(false), needsProtectPrompt: true }
  })
  api.setProtectedPaths.mockResolvedValue(withCanon(true))
  api.openProjectDialog.mockResolvedValue({
    root: '/q',
    name: 'q',
    tree: canonTree,
    protection: withCanon(false)
  })
  render(<App />)
  fireEvent.click(await screen.findByRole('checkbox', { name: 'canon' }))
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  await waitFor(() => expect(api.setProtectedPaths).toHaveBeenCalledWith('/p', ['canon']))
  await waitFor(async () => expect(await canonTag()).not.toBeNull())
  act(() => menu!('open-project'))
  await waitFor(() => expect(api.openProjectDialog).toHaveBeenCalled())
  await waitFor(async () => expect(await canonTag()).toBeNull())
})

const draftsTree = [
  {
    name: 'drafts',
    relPath: 'drafts',
    kind: 'folder' as const,
    children: [] as never[]
  }
]

it('asks which folders to protect when the project has no settings', async () => {
  const api = stub('/p')
  const prompt = { ...noProtection, needsProtectPrompt: true }
  api.openProject.mockResolvedValue({ root: '/p', name: 'p', tree: draftsTree, protection: prompt })
  api.setProtectedPaths.mockResolvedValue({
    ...noProtection,
    settings: { version: 2, protected: ['drafts'] }
  })
  render(<App />)
  expect(await screen.findByRole('dialog')).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: 'drafts' })).toBeChecked()
  expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  await waitFor(() => expect(api.setProtectedPaths).toHaveBeenCalledWith('/p', ['drafts']))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

it('does not ask when settings exist', async () => {
  stub('/p')
  render(<App />)
  await screen.findByTestId('tree-panel')
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('keeps the dialog open and shows the error inside it when saving protected folders fails', async () => {
  const api = stub('/p')
  api.openProject.mockResolvedValue({
    root: '/p',
    name: 'p',
    tree: draftsTree,
    protection: { ...noProtection, needsProtectPrompt: true }
  })
  api.setProtectedPaths.mockRejectedValueOnce(new Error('disk full'))
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'Done' }))
  const dialog = screen.getByRole('dialog')
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('disk full')
  expect(screen.getAllByText('disk full')).toHaveLength(1)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled())
  const retry = deferred<typeof noProtection>()
  api.setProtectedPaths.mockReturnValueOnce(retry.promise)
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  expect(within(dialog).queryByRole('alert')).toBeNull()
  await act(async () => retry.resolve(noProtection))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.queryByRole('alert')).toBeNull()
})

it('has no Prose folders button', async () => {
  stub('/p')
  render(<App />)
  await screen.findByTestId('tree-panel')
  expect(screen.queryByRole('button', { name: /prose folders/i })).toBeNull()
})

it('does not ask when settings are unreadable', async () => {
  const api = stub('/p')
  api.openProject.mockResolvedValue({
    root: '/p',
    name: 'p',
    tree: [],
    protection: { ...noProtection, unreadable: true, needsProtectPrompt: true }
  })
  render(<App />)
  await screen.findByTestId('tree-panel')
  expect(screen.queryByRole('dialog')).toBeNull()
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
  api.openProject.mockResolvedValue({
    root: '/p',
    name: 'p',
    tree: notesTree,
    protection: noProtection
  })
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

const menuTree = [
  { name: 'drafts', relPath: 'drafts', kind: 'folder' as const, children: [] as never[] },
  {
    name: 'notes',
    relPath: 'notes',
    kind: 'folder' as const,
    children: [{ name: 'a.md', relPath: 'notes/a.md', kind: 'file' as const }]
  }
]
const draftsProtected = {
  ...noProtection,
  settings: { version: 2 as const, protected: ['drafts'] }
}

function menuProject(): ReturnType<typeof stub> {
  const api = stub('/p')
  api.openProject.mockResolvedValue({
    root: '/p',
    name: 'p',
    tree: menuTree,
    protection: draftsProtected
  })
  return api
}

const rightClick = async (region: 'Protected' | 'Project', name: string): Promise<void> => {
  fireEvent.contextMenu(within(await screen.findByRole('region', { name: region })).getByText(name))
}

it('right-click protect saves', async () => {
  const api = menuProject()
  api.showTreeMenu.mockResolvedValue('protect')
  render(<App />)
  await rightClick('Project', 'notes')
  await waitFor(() =>
    expect(api.changeProtectionMany).toHaveBeenCalledWith('/p', 'protect', ['notes'])
  )
  expect(api.showTreeMenu).toHaveBeenCalledWith(
    menuFor({ kind: 'folder', protectRule: 'protect', canPaste: false })
  )
})

it('stop protecting saves', async () => {
  const api = menuProject()
  api.showTreeMenu.mockResolvedValue('unprotect')
  render(<App />)
  await rightClick('Protected', 'drafts')
  await waitFor(() =>
    expect(api.changeProtectionMany).toHaveBeenCalledWith('/p', 'unprotect', ['drafts'])
  )
  expect(api.showTreeMenu).toHaveBeenCalledWith(
    menuFor({ kind: 'folder', protectRule: 'unprotect', canPaste: false })
  )
})

it('no menu while the settings file is unreadable', async () => {
  const api = menuProject()
  api.openProject.mockResolvedValue({
    root: '/p',
    name: 'p',
    tree: menuTree,
    protection: { ...noProtection, unreadable: true }
  })
  render(<App />)
  await rightClick('Project', 'notes')
  await act(async () => {})
  expect(api.showTreeMenu).not.toHaveBeenCalled()
})

it('a dismissed menu writes nothing', async () => {
  const api = menuProject()
  api.showTreeMenu.mockResolvedValue(null)
  render(<App />)
  await rightClick('Project', 'notes')
  await waitFor(() => expect(api.showTreeMenu).toHaveBeenCalled())
  await act(async () => {})
  expect(api.changeProtectionMany).not.toHaveBeenCalled()
})

it('a second action during a save is ignored', async () => {
  const api = menuProject()
  api.showTreeMenu.mockResolvedValue('protect')
  const d = deferred<{
    protection: typeof draftsProtected
    delta: { added: string[]; removed: string[] }
  }>()
  api.changeProtectionMany.mockReturnValue(d.promise)
  render(<App />)
  await rightClick('Project', 'notes')
  await waitFor(() => expect(api.changeProtectionMany).toHaveBeenCalledTimes(1))
  await rightClick('Project', 'notes')
  await act(async () => {})
  expect(api.changeProtectionMany).toHaveBeenCalledTimes(1)
  expect(api.showTreeMenu).toHaveBeenCalledTimes(1)
  await act(async () =>
    d.resolve({ protection: draftsProtected, delta: { added: [], removed: [] } })
  )
})

it('a failed save shows the app error and leaves the sections unchanged', async () => {
  const api = menuProject()
  api.showTreeMenu.mockResolvedValue('protect')
  api.changeProtectionMany.mockRejectedValue(new Error('disk full'))
  render(<App />)
  await rightClick('Project', 'notes')
  expect(await screen.findByRole('alert')).toHaveTextContent('disk full')
  const prot = screen.getByRole('region', { name: 'Protected' })
  expect(within(prot).getByText('drafts')).toBeInTheDocument()
  expect(within(prot).queryByText('notes')).toBeNull()
})

it("protecting the open file's folder updates the banner", async () => {
  const api = menuProject()
  api.showTreeMenu.mockResolvedValue('protect')
  api.changeProtectionMany.mockResolvedValue({
    protection: { ...noProtection, settings: { version: 2, protected: ['notes'] } },
    delta: { added: ['notes'], removed: [] }
  })
  Object.assign(api, {
    readDoc: vi.fn().mockResolvedValue({ content: 'hello\n', mtimeMs: 1 }),
    writeDoc: vi.fn(),
    onFlushRequest: vi.fn(),
    lintGrammar: vi.fn(async (texts: string[]) => texts.map(() => []))
  })
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'a' }))
  await waitFor(() =>
    expect(screen.getByTestId('editor-panel').querySelector('.ProseMirror')).toHaveTextContent(
      'hello'
    )
  )
  expect(screen.queryByText("Protected — AI won't edit")).toBeNull()
  await rightClick('Project', 'notes')
  expect(await screen.findByText("Protected — AI won't edit")).toBeInTheDocument()
  expect((api as unknown as Record<string, Mock>).writeDoc).not.toHaveBeenCalled()
})

// ---- File actions ----

type Node = { name: string; relPath: string; kind: 'file' | 'folder'; children?: Node[] }
const file = (relPath: string): Node => ({
  name: relPath.split('/').pop()!,
  relPath,
  kind: 'file'
})
const folder = (relPath: string, children: Node[] = []): Node => ({
  name: relPath.split('/').pop()!,
  relPath,
  kind: 'folder',
  children
})
const actionTree = [folder('canon'), folder('drafts'), folder('notes', [file('notes/a.md')])]
const renamedTree = [folder('canon'), folder('drafts'), folder('notes', [file('notes/b.md')])]

/** A project with the editor's dependencies stubbed, so files can be opened. */
function actionProject(): ReturnType<typeof stub> & Record<'readDoc' | 'writeDoc', Mock> {
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  Range.prototype.getClientRects = () =>
    ({
      length: 0,
      item: () => null,
      [Symbol.iterator]: [][Symbol.iterator]
    }) as unknown as DOMRectList
  document.elementFromPoint = () => null
  const api = stub('/p')
  api.openProject.mockResolvedValue({
    root: '/p',
    name: 'p',
    tree: actionTree,
    protection: draftsProtected
  })
  const more = {
    readDoc: vi.fn().mockResolvedValue({ content: '', mtimeMs: 1 }),
    writeDoc: vi.fn(),
    onFlushRequest: vi.fn(),
    lintGrammar: vi.fn(async (texts: string[]) => texts.map(() => []))
  }
  Object.assign(api, more)
  return api as ReturnType<typeof stub> & Record<'readDoc' | 'writeDoc', Mock>
}

const treeBox = (): HTMLElement => screen.getByRole('group', { name: 'Files' })
const focusTree = (): void => act(() => treeBox().focus())
const key = (k: string, mods: { metaKey?: boolean; shiftKey?: boolean } = {}): void => {
  fireEvent.keyDown(treeBox(), { key: k, ...mods })
}
const pathLabel = (): HTMLElement | null =>
  within(screen.getByTestId('editor-panel')).queryByText(/^notes\//)

async function openA(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: 'a' }))
  await waitFor(() => expect(pathLabel()).toHaveTextContent('notes/a.md'))
}

async function renameAToB(api: ReturnType<typeof actionProject>): Promise<void> {
  api.renameEntry.mockResolvedValue({
    tree: renamedTree,
    protection: draftsProtected,
    move: { from: 'notes/a.md', to: 'notes/b.md' }
  })
  api.showTreeMenu.mockResolvedValueOnce('rename')
  await rightClick('Project', 'a')
  const box = await screen.findByRole('textbox', { name: 'Name' })
  fireEvent.change(box, { target: { value: 'b' } })
  fireEvent.keyDown(box, { key: 'Enter' })
  await waitFor(() => expect(api.renameEntry).toHaveBeenCalledWith('/p', 'notes/a.md', 'b'))
  await screen.findByRole('button', { name: 'b' })
}

it('rename the open file keeps it open at the new path', async () => {
  const api = actionProject()
  render(<App />)
  await openA()
  await renameAToB(api)
  await waitFor(() => expect(pathLabel()).toHaveTextContent('notes/b.md'))
  expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull()
})

it('renaming a folder that holds the open file saves first', async () => {
  const api = actionProject()
  api.renameEntry.mockResolvedValue({
    tree: [folder('canon'), folder('drafts'), folder('ideas', [file('ideas/a.md')])],
    protection: draftsProtected,
    move: { from: 'notes', to: 'ideas' }
  })
  render(<App />)
  await openA()
  vi.mocked(flushAll).mockClear()
  api.showTreeMenu.mockResolvedValueOnce('rename')
  await rightClick('Project', 'notes')
  const box = await screen.findByRole('textbox', { name: 'Name' })
  fireEvent.change(box, { target: { value: 'ideas' } })
  fireEvent.keyDown(box, { key: 'Enter' })
  await waitFor(() => expect(api.renameEntry).toHaveBeenCalledWith('/p', 'notes', 'ideas'))
  expect(flushAll).toHaveBeenCalled()
  expect(vi.mocked(flushAll).mock.invocationCallOrder[0]).toBeLessThan(
    api.renameEntry.mock.invocationCallOrder[0]
  )
  await waitFor(() =>
    expect(within(screen.getByTestId('editor-panel')).getByText('ideas/a.md')).toBeInTheDocument()
  )
})

it('trash asks first', async () => {
  const api = actionProject()
  api.confirmDialog.mockResolvedValue(false)
  api.showTreeMenu.mockResolvedValueOnce('trash')
  render(<App />)
  await rightClick('Project', 'a')
  await waitFor(() =>
    expect(api.confirmDialog).toHaveBeenCalledWith({
      message: 'Move "a" to the Trash?',
      ok: 'Move to Trash'
    })
  )
  await act(async () => {})
  expect(api.trashEntries).not.toHaveBeenCalled()
})

it('trashing a folder says it includes everything, and closes the open file inside it', async () => {
  const api = actionProject()
  api.trashEntries.mockResolvedValue({
    tree: [folder('canon'), folder('drafts')],
    protection: draftsProtected,
    trashed: [{ id: 't1', from: 'notes', protectedEntries: [] }]
  })
  render(<App />)
  await openA()
  api.showTreeMenu.mockResolvedValueOnce('trash')
  await rightClick('Project', 'notes')
  await waitFor(() => expect(api.trashEntries).toHaveBeenCalledWith('/p', ['notes']))
  expect(api.confirmDialog).toHaveBeenCalledWith({
    message: 'Move "notes" to the Trash?',
    detail: 'This includes everything in it.',
    ok: 'Move to Trash'
  })
  expect(await screen.findByText('Choose a file from the project')).toBeInTheDocument()
})

it('copy then paste into a folder', async () => {
  const api = actionProject()
  api.pasteEntries.mockResolvedValue({
    tree: actionTree,
    protection: draftsProtected,
    created: ['canon/a.md'],
    moves: []
  })
  render(<App />)
  await openA()
  focusTree()
  key('c', { metaKey: true })
  fireEvent.click(screen.getByRole('button', { name: 'canon' }))
  key('v', { metaKey: true })
  await waitFor(() =>
    expect(api.pasteEntries).toHaveBeenCalledWith('/p', 'copy', ['notes/a.md'], 'canon')
  )
})

it('Cmd+Z in the tree undoes the rename', async () => {
  const api = actionProject()
  api.moveExact.mockResolvedValue({ tree: actionTree, protection: draftsProtected })
  render(<App />)
  await openA()
  await renameAToB(api)
  await waitFor(() => expect(treeBox()).toHaveFocus())
  act(() => menu!('undo'))
  await waitFor(() =>
    expect(api.moveExact).toHaveBeenCalledWith('/p', [{ from: 'notes/b.md', to: 'notes/a.md' }])
  )
  await waitFor(() => expect(pathLabel()).toHaveTextContent('notes/a.md'))
})

it('undo failure shows the error line', async () => {
  const api = actionProject()
  api.moveExact.mockRejectedValue(
    new Error('Error invoking remote method \'file:moveExact\': Error: "a.md" already exists')
  )
  render(<App />)
  await renameAToB(api)
  focusTree()
  act(() => menu!('undo'))
  expect(await screen.findByRole('alert')).toHaveTextContent('Can\'t undo: "a.md" already exists')
})

it('keys do nothing when the tree is not focused', async () => {
  const api = actionProject()
  render(<App />)
  await openA()
  focusTree()
  const input = within(screen.getByTestId('chat-panel')).getByLabelText('Message')
  act(() => input.focus())
  fireEvent.keyDown(input, { key: 'Backspace', metaKey: true })
  key('Backspace', { metaKey: true })
  await act(async () => {})
  expect(api.confirmDialog).not.toHaveBeenCalled()
  expect(api.trashEntries).not.toHaveBeenCalled()
})

it('switching projects clears the clipboard', async () => {
  const api = actionProject()
  api.openProjectDialog.mockResolvedValue({
    root: '/q',
    name: 'q',
    tree: [folder('canon')],
    protection: noProtection
  })
  render(<App />)
  await openA()
  focusTree()
  key('c', { metaKey: true })
  act(() => menu!('open-project'))
  await waitFor(() => expect(api.openProjectDialog).toHaveBeenCalled())
  await waitFor(() => expect(screen.queryByRole('button', { name: 'notes' })).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: 'canon' }))
  focusTree()
  key('v', { metaKey: true })
  await act(async () => {})
  expect(api.pasteEntries).not.toHaveBeenCalled()
})

it('New File opens the created file', async () => {
  const api = actionProject()
  api.createEntry.mockResolvedValue({
    tree: [
      folder('canon', [file('canon/ch.md')]),
      folder('drafts'),
      folder('notes', [file('notes/a.md')])
    ],
    protection: draftsProtected,
    relPath: 'canon/ch.md'
  })
  api.showTreeMenu.mockResolvedValueOnce('new-file')
  render(<App />)
  await rightClick('Project', 'canon')
  const box = await screen.findByRole('textbox', { name: 'Name' })
  fireEvent.change(box, { target: { value: 'ch' } })
  fireEvent.keyDown(box, { key: 'Enter' })
  await waitFor(() => expect(api.createEntry).toHaveBeenCalledWith('/p', 'file', 'canon', 'ch'))
  await waitFor(() =>
    expect(within(screen.getByTestId('editor-panel')).getByText('canon/ch.md')).toBeInTheDocument()
  )
  await waitFor(() => expect(treeBox()).toHaveFocus())
})

it('undoing a new file with text in it asks first', async () => {
  const api = actionProject()
  api.createEntry.mockResolvedValue({
    tree: [
      folder('canon', [file('canon/ch.md')]),
      folder('drafts'),
      folder('notes', [file('notes/a.md')])
    ],
    protection: draftsProtected,
    relPath: 'canon/ch.md'
  })
  api.showTreeMenu.mockResolvedValueOnce('new-file')
  render(<App />)
  await rightClick('Project', 'canon')
  const box = await screen.findByRole('textbox', { name: 'Name' })
  fireEvent.change(box, { target: { value: 'ch' } })
  fireEvent.keyDown(box, { key: 'Enter' })
  await waitFor(() => expect(api.createEntry).toHaveBeenCalled())
  api.readDoc.mockResolvedValue({ content: 'Some words\n', mtimeMs: 2 })
  api.confirmDialog.mockResolvedValue(false)
  await waitFor(() => expect(treeBox()).toHaveFocus())
  act(() => menu!('undo'))
  await waitFor(() =>
    expect(api.confirmDialog).toHaveBeenCalledWith({
      message: 'Undo New File? "ch" has text in it. It will go to the Trash.',
      ok: 'Undo'
    })
  )
  await act(async () => {})
  expect(api.removeCreated).not.toHaveBeenCalled()
})

it('arrow keys move the selection and Return renames it', async () => {
  const api = actionProject()
  render(<App />)
  await screen.findByRole('button', { name: 'a' })
  focusTree()
  key('ArrowDown')
  key('ArrowDown')
  key('ArrowDown')
  key('ArrowDown')
  // drafts (protected), canon, notes, then a
  const row = screen.getByRole('button', { name: 'a' }).closest('[role="treeitem"]')
  expect(row).toHaveAttribute('aria-selected', 'true')
  key('Enter')
  expect(await screen.findByRole('textbox', { name: 'Name' })).toHaveValue('a')
  expect(api.renameEntry).not.toHaveBeenCalled()
})

it('protecting from the menu with no change pushes nothing to undo', async () => {
  const api = actionProject()
  api.showTreeMenu.mockResolvedValueOnce('protect')
  render(<App />)
  await rightClick('Project', 'canon')
  await waitFor(() => expect(api.changeProtectionMany).toHaveBeenCalled())
  focusTree()
  act(() => menu!('undo'))
  await act(async () => {})
  expect(api.applyProtectionDelta).not.toHaveBeenCalled()
})

it('a new file in a collapsed nested folder stays shown after the box closes', async () => {
  const api = actionProject()
  const nested = [folder('canon'), folder('drafts'), folder('notes', [folder('notes/sub')])]
  api.openProject.mockResolvedValue({
    root: '/p',
    name: 'p',
    tree: nested,
    protection: draftsProtected
  })
  api.createEntry.mockResolvedValue({
    tree: [
      folder('canon'),
      folder('drafts'),
      folder('notes', [folder('notes/sub', [file('notes/sub/x.md')])])
    ],
    protection: draftsProtected,
    relPath: 'notes/sub/x.md'
  })
  api.showTreeMenu.mockResolvedValueOnce('new-file')
  render(<App />)
  await rightClick('Project', 'sub')
  const box = await screen.findByRole('textbox', { name: 'Name' })
  fireEvent.change(box, { target: { value: 'x' } })
  fireEvent.keyDown(box, { key: 'Enter' })
  await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull())
  expect(screen.getByRole('button', { name: 'x' })).toBeInTheDocument()
})

it('a cut pasted back into its own folder keeps the clipboard', async () => {
  const api = actionProject()
  api.pasteEntries.mockResolvedValue({
    tree: actionTree,
    protection: draftsProtected,
    created: [],
    moves: []
  })
  render(<App />)
  await openA()
  focusTree()
  key('x', { metaKey: true })
  key('v', { metaKey: true })
  await waitFor(() => expect(api.pasteEntries).toHaveBeenCalledTimes(1))
  await act(async () => {})
  key('v', { metaKey: true })
  await waitFor(() => expect(api.pasteEntries).toHaveBeenCalledTimes(2))
  expect(screen.getByRole('button', { name: 'a' }).closest('.cb-row')).toHaveClass('cb-row-cut')
  focusTree()
  act(() => menu!('undo'))
  await act(async () => {})
  expect(api.moveExact).not.toHaveBeenCalled()
})

it('a folder selected with its own child protects the folder only', async () => {
  const api = actionProject()
  api.showTreeMenu.mockResolvedValueOnce('protect')
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'notes' }), { metaKey: true })
  fireEvent.click(screen.getByRole('button', { name: 'a' }), { metaKey: true })
  await rightClick('Project', 'notes')
  await waitFor(() =>
    expect(api.changeProtectionMany).toHaveBeenCalledWith('/p', 'protect', ['notes'])
  )
  expect(api.showTreeMenu).toHaveBeenCalledWith(
    menuFor({ kind: 'multi', protectRule: 'protect', canPaste: false })
  )
})

it('the undo menu command with the editor focused uses native undo, not file undo', async () => {
  const api = actionProject()
  api.moveExact.mockResolvedValue({ tree: actionTree, protection: draftsProtected })
  render(<App />)
  await openA()
  await renameAToB(api)
  const input = within(screen.getByTestId('chat-panel')).getByLabelText('Message')
  act(() => input.focus())
  act(() => menu!('undo'))
  await act(async () => {})
  expect(api.nativeUndo).toHaveBeenCalledTimes(1)
  expect(api.moveExact).not.toHaveBeenCalled()
  act(() => menu!('redo'))
  expect(api.nativeRedo).toHaveBeenCalledTimes(1)
})

it('the undo menu command with the tree focused and nothing to undo does nothing', async () => {
  const api = actionProject()
  render(<App />)
  await openA()
  focusTree()
  act(() => menu!('undo'))
  act(() => menu!('redo'))
  await act(async () => {})
  expect(api.nativeUndo).not.toHaveBeenCalled()
  expect(api.nativeRedo).not.toHaveBeenCalled()
  expect(api.moveExact).not.toHaveBeenCalled()
})

it('Cmd+Z in the tree is left for the menu accelerator', async () => {
  const api = actionProject()
  render(<App />)
  await openA()
  focusTree()
  const ev = createEvent.keyDown(treeBox(), { key: 'z', metaKey: true })
  fireEvent(treeBox(), ev)
  expect(ev.defaultPrevented).toBe(false)
  expect(api.moveExact).not.toHaveBeenCalled()
})

it('undo while the name box is open is native text undo, not file undo', async () => {
  const api = actionProject()
  api.moveExact.mockResolvedValue({ tree: actionTree, protection: draftsProtected })
  render(<App />)
  await openA()
  await renameAToB(api)
  await waitFor(() => expect(treeBox()).toHaveFocus())
  api.showTreeMenu.mockResolvedValueOnce('rename')
  await rightClick('Project', 'b')
  const box = await screen.findByRole('textbox', { name: 'Name' })
  act(() => box.focus())
  act(() => menu!('undo'))
  await act(async () => {})
  expect(api.nativeUndo).toHaveBeenCalledTimes(1)
  expect(api.moveExact).not.toHaveBeenCalled()
})
