import { app, dialog, ipcMain, nativeTheme, safeStorage, shell, BrowserWindow } from 'electron'
import { basename, join } from 'path'
import { stat } from 'fs/promises'
import { createProject, listTree, readDoc, requireCurrentRoot, writeDoc } from './projectFs'
import {
  applyProtectionDelta,
  changeProtectionMany,
  loadProjectProtection,
  setProtectedPaths
} from './projectSettings'
import {
  checkedPath,
  createEntry,
  duplicateEntries,
  moveExact,
  pasteEntries,
  removeCreated,
  renameEntry,
  restoreEntries,
  trashEntries
} from './fileOps'
import { flushHoldingArea } from './trashFlush'
import { TREE_MENU_LABELS, type TreeMenuItem } from '../shared/treeMenuItems'
import { showTreeMenu } from './treeMenu'
import { createSettingsStore, type SettingsStore } from './appSettings'
import { parseLintRequest } from './grammar/grammarService'
import { createSecretStore } from './ai/secrets'
import { createAiConfig, type AiConfig } from './ai/aiConfig'
import { listChats, loadChat, saveChat } from './chats'
import { createChatService, type ChatService } from './ai/chatService'
import { createProposalStore } from './ai/proposals'
import {
  CHAT_ID_RE,
  CLOUD_PROVIDERS,
  parseChatRequest,
  parseChatThread,
  parseModelChoice,
  type CloudProvider,
  type ModelChoice
} from '../shared/ai'
import type {
  AppSettings,
  EntryKind,
  GrammarLint,
  Move,
  ProjectInfo,
  ProtectionDelta,
  ThemeSetting,
  TrashedItem
} from '../shared/types'

let currentRoot: string | null = null

function templateDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'template')
    : join(app.getAppPath(), 'template')
}

function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

let settingsStore: SettingsStore | null = null
function settings(): SettingsStore {
  return (settingsStore ??= createSettingsStore(settingsFile()))
}

let aiConfig: AiConfig | null = null
function ai(): AiConfig {
  return (aiConfig ??= createAiConfig({
    settings: settings(),
    secrets: createSecretStore(join(app.getPath('userData'), 'secrets.json'), safeStorage),
    fetch: (input, init) => fetch(input, init)
  }))
}

/** The AI's pending suggestions, shared by the chat service (which makes them) and Accept/Reject. */
const proposals = createProposalStore()

let chatService: ChatService | null = null
function chat(): ChatService {
  return (chatService ??= createChatService({
    resolve: (p) => ai().resolve(p),
    fetch: (input, init) => fetch(input, init),
    proposals
  }))
}

/** Stop every streaming reply (project switch, window close). */
export function cancelAllChats(): void {
  chatService?.cancelAll()
}

const THEMES: readonly string[] = ['light', 'dark', 'system']
function isTheme(x: unknown): x is ThemeSetting {
  return typeof x === 'string' && THEMES.includes(x)
}

function isCloudProvider(x: unknown): x is CloudProvider {
  return typeof x === 'string' && (CLOUD_PROVIDERS as readonly string[]).includes(x)
}

function stringOrNull(x: unknown): string | null {
  if (x === null) return null
  if (typeof x === 'string') return x
  throw new Error('Invalid argument')
}

function requireRoot(): string {
  if (!currentRoot) throw new Error('No project open')
  return currentRoot
}

async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const next = await settings().update((s) => ({ ...s, ...patch }))
  if ('theme' in patch) nativeTheme.themeSource = next.theme
  return next
}

function isStringArray(x: unknown): x is string[] {
  return Array.isArray(x) && x.every((p) => typeof p === 'string')
}

function isMove(x: unknown): x is Move {
  const m = x as Move | null
  return !!m && typeof m === 'object' && typeof m.from === 'string' && typeof m.to === 'string'
}

function isTrashedItem(x: unknown): x is TrashedItem {
  const t = x as TrashedItem | null
  return (
    !!t &&
    typeof t === 'object' &&
    typeof t.id === 'string' &&
    typeof t.from === 'string' &&
    isStringArray(t.protectedEntries)
  )
}

function isDelta(x: unknown): x is ProtectionDelta {
  const d = x as ProtectionDelta | null
  return !!d && typeof d === 'object' && isStringArray(d.added) && isStringArray(d.removed)
}

function isMenuItem(x: unknown): x is TreeMenuItem | '-' {
  return x === '-' || (typeof x === 'string' && Object.hasOwn(TREE_MENU_LABELS, x))
}

/** Moves the holding area's items to the Mac Trash; never throws. */
export async function flushTrash(root: string | null): Promise<void> {
  if (!root) return
  try {
    await flushHoldingArea(root, (p) => shell.trashItem(p))
  } catch (err) {
    console.error('Could not flush the holding area:', err)
  }
}

/** The current project's holding area goes to the Trash before the app quits. */
export function flushCurrentTrash(): Promise<void> {
  return flushTrash(currentRoot)
}

async function openProject(root: string): Promise<ProjectInfo> {
  if (!(await stat(root)).isDirectory()) throw new Error('Not a directory')
  const tree = await listTree(root)
  // Earlier sessions' trashed items go to the Mac Trash; so do the ones in the project being left.
  await flushTrash(root)
  if (currentRoot && currentRoot !== root) await flushTrash(currentRoot)
  cancelAllChats()
  proposals.clear()
  currentRoot = root
  await updateSettings({ lastProjectRoot: root })
  return { root, name: basename(root), tree, protection: await loadProjectProtection(root) }
}

/** Apply the stored theme to native chrome before the window shows, to avoid a flash. */
export async function applyStoredTheme(): Promise<void> {
  nativeTheme.themeSource = (await settings().load()).theme
}

export function registerIpc(grammar: { lint(texts: string[]): Promise<GrammarLint[][]> }): void {
  const rootArg = (root: unknown): string => {
    if (typeof root !== 'string') throw new Error('Invalid argument')
    return requireCurrentRoot(currentRoot, root)
  }
  const parentOf = (e: Electron.IpcMainInvokeEvent): BrowserWindow | undefined =>
    BrowserWindow.fromWebContents(e.sender) ?? undefined

  ipcMain.handle('canonball:openProjectDialog', async (e) => {
    const win = parentOf(e)
    const opts: Electron.OpenDialogOptions = { properties: ['openDirectory'] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled || !r.filePaths[0] ? null : openProject(r.filePaths[0])
  })

  ipcMain.handle('canonball:newProjectDialog', async (e) => {
    const win = parentOf(e)
    const opts: Electron.SaveDialogOptions = {
      title: 'New Project',
      buttonLabel: 'Create',
      nameFieldLabel: 'Project folder name:'
    }
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return null
    await createProject(r.filePath, templateDir())
    return openProject(r.filePath)
  })

  ipcMain.handle('canonball:openProject', (_e, root: string) => openProject(root))
  ipcMain.handle('canonball:refreshTree', () => listTree(requireRoot()))
  ipcMain.handle('canonball:readDoc', (_e, relPath: string) => readDoc(requireRoot(), relPath))
  ipcMain.handle('canonball:writeDoc', (_e, root: string, relPath: string, content: string) =>
    writeDoc(requireCurrentRoot(currentRoot, root), relPath, content)
  )
  ipcMain.handle('canonball:getProjectProtection', () => loadProjectProtection(requireRoot()))
  ipcMain.handle('canonball:setProtectedPaths', (_e, root: string, paths: unknown) => {
    const r = requireCurrentRoot(currentRoot, root)
    if (!Array.isArray(paths) || !paths.every((p) => typeof p === 'string')) {
      throw new Error('Invalid argument')
    }
    return setProtectedPaths(r, paths)
  })
  ipcMain.handle('canonball:showTreeMenu', (e, items: unknown) => {
    if (!Array.isArray(items) || !items.every(isMenuItem)) throw new Error('Invalid argument')
    const win = parentOf(e)
    if (!win) throw new Error('No window')
    return showTreeMenu(win, items)
  })
  ipcMain.handle('canonball:confirmDialog', async (e, opts: unknown) => {
    const o = opts as { message?: unknown; detail?: unknown; ok?: unknown } | null
    if (
      !o ||
      typeof o.message !== 'string' ||
      typeof o.ok !== 'string' ||
      (o.detail !== undefined && typeof o.detail !== 'string')
    ) {
      throw new Error('Invalid argument')
    }
    const win = parentOf(e)
    const options: Electron.MessageBoxOptions = {
      type: 'warning',
      message: o.message,
      detail: o.detail,
      buttons: [o.ok, 'Cancel'],
      defaultId: 0,
      cancelId: 1
    }
    const { response } = win
      ? await dialog.showMessageBox(win, options)
      : await dialog.showMessageBox(options)
    return response === 0
  })
  ipcMain.handle('canonball:nativeUndo', (e) => e.sender.undo())
  ipcMain.handle('canonball:nativeRedo', (e) => e.sender.redo())
  ipcMain.handle(
    'canonball:createEntry',
    (_e, root: unknown, kind: unknown, parentRel: unknown, name: unknown) => {
      const r = rootArg(root)
      if (
        (kind !== 'file' && kind !== 'folder') ||
        typeof parentRel !== 'string' ||
        typeof name !== 'string'
      ) {
        throw new Error('Invalid argument')
      }
      return createEntry(r, kind as EntryKind, parentRel, name)
    }
  )
  ipcMain.handle('canonball:renameEntry', (_e, root: unknown, relPath: unknown, name: unknown) => {
    const r = rootArg(root)
    if (typeof relPath !== 'string' || typeof name !== 'string') throw new Error('Invalid argument')
    return renameEntry(r, relPath, name)
  })
  ipcMain.handle(
    'canonball:pasteEntries',
    (_e, root: unknown, mode: unknown, relPaths: unknown, destRel: unknown) => {
      const r = rootArg(root)
      if (
        (mode !== 'copy' && mode !== 'move') ||
        !isStringArray(relPaths) ||
        typeof destRel !== 'string'
      ) {
        throw new Error('Invalid argument')
      }
      return pasteEntries(r, mode, relPaths, destRel)
    }
  )
  ipcMain.handle('canonball:duplicateEntries', (_e, root: unknown, relPaths: unknown) => {
    const r = rootArg(root)
    if (!isStringArray(relPaths)) throw new Error('Invalid argument')
    return duplicateEntries(r, relPaths)
  })
  ipcMain.handle('canonball:moveExact', (_e, root: unknown, moves: unknown) => {
    const r = rootArg(root)
    if (!Array.isArray(moves) || !moves.every(isMove)) throw new Error('Invalid argument')
    return moveExact(r, moves)
  })
  ipcMain.handle('canonball:trashEntries', (_e, root: unknown, relPaths: unknown) => {
    const r = rootArg(root)
    if (!isStringArray(relPaths)) throw new Error('Invalid argument')
    return trashEntries(r, relPaths)
  })
  ipcMain.handle('canonball:restoreEntries', (_e, root: unknown, items: unknown) => {
    const r = rootArg(root)
    if (!Array.isArray(items) || !items.every(isTrashedItem)) throw new Error('Invalid argument')
    return restoreEntries(r, items)
  })
  ipcMain.handle('canonball:removeCreated', (_e, root: unknown, relPaths: unknown) => {
    const r = rootArg(root)
    if (!isStringArray(relPaths)) throw new Error('Invalid argument')
    return removeCreated(r, relPaths)
  })
  ipcMain.handle(
    'canonball:changeProtectionMany',
    (_e, root: unknown, kind: unknown, relPaths: unknown) => {
      const r = rootArg(root)
      if ((kind !== 'protect' && kind !== 'unprotect') || !isStringArray(relPaths)) {
        throw new Error('Invalid argument')
      }
      return changeProtectionMany(r, kind, relPaths)
    }
  )
  ipcMain.handle('canonball:applyProtectionDelta', (_e, root: unknown, delta: unknown) => {
    const r = rootArg(root)
    if (!isDelta(delta)) throw new Error('Invalid argument')
    return applyProtectionDelta(r, delta)
  })
  ipcMain.handle('canonball:revealEntry', (_e, root: unknown, relPath: unknown) => {
    const r = rootArg(root)
    if (typeof relPath !== 'string') throw new Error('Invalid argument')
    shell.showItemInFolder(checkedPath(r, relPath))
  })
  ipcMain.handle('canonball:lintGrammar', (_e, texts: unknown) =>
    grammar.lint(parseLintRequest(texts))
  )
  ipcMain.handle('canonball:getSettings', () => settings().load())
  // AI settings change only through the dedicated channels below.
  ipcMain.handle('canonball:setSettings', (_e, patch: unknown) => {
    const theme = (patch as { theme?: unknown } | null)?.theme
    return isTheme(theme) ? updateSettings({ theme }) : settings().load()
  })

  ipcMain.handle('canonball:getAiStatus', () => ai().status())
  ipcMain.handle('canonball:setApiKey', (_e, provider: unknown, key: unknown) => {
    if (!isCloudProvider(provider)) throw new Error('Invalid argument')
    return ai().setApiKey(provider, stringOrNull(key))
  })
  ipcMain.handle('canonball:setLocalUrl', (_e, url: unknown) => ai().setLocalUrl(stringOrNull(url)))
  ipcMain.handle('canonball:setModel', (_e, choice: unknown) => {
    let parsed: ModelChoice | null = null
    if (choice !== null) {
      parsed = parseModelChoice(choice)
      if (!parsed) throw new Error('Invalid argument')
    }
    return ai().setModel(parsed)
  })
  ipcMain.handle('canonball:listModels', () => ai().listModels())
  ipcMain.handle('canonball:startChat', (e, req: unknown) => {
    const parsed = parseChatRequest(req)
    if (!parsed) throw new Error('Invalid argument')
    const wc = e.sender
    chat().start(parsed, currentRoot, (ev) => {
      if (!wc.isDestroyed()) wc.send('canonball:chatEvent', ev)
    })
  })
  ipcMain.handle('canonball:cancelChat', (_e, requestId: unknown) => {
    if (typeof requestId !== 'string') throw new Error('Invalid argument')
    chat().cancel(requestId)
  })
  ipcMain.handle('canonball:applyProposal', (_e, root: unknown, id: unknown) => {
    if (typeof root !== 'string' || typeof id !== 'string' || !CHAT_ID_RE.test(id)) {
      throw new Error('Invalid argument')
    }
    return proposals.apply(requireCurrentRoot(currentRoot, root), id)
  })
  ipcMain.handle('canonball:rejectProposal', (_e, id: unknown) => {
    if (typeof id !== 'string' || !CHAT_ID_RE.test(id)) throw new Error('Invalid argument')
    proposals.reject(id)
  })
  ipcMain.handle('canonball:listChats', () => listChats(requireRoot()))
  ipcMain.handle('canonball:loadChat', (_e, id: unknown) => {
    if (typeof id !== 'string') throw new Error('Invalid argument')
    return loadChat(requireRoot(), id)
  })
  ipcMain.handle('canonball:saveChat', (_e, root: unknown, thread: unknown) => {
    if (typeof root !== 'string') throw new Error('Invalid argument')
    const r = requireCurrentRoot(currentRoot, root)
    const parsed = parseChatThread(thread)
    if (!parsed) throw new Error('Invalid argument')
    return saveChat(r, parsed)
  })
}
