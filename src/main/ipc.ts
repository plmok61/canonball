import { app, dialog, ipcMain, nativeTheme, safeStorage, BrowserWindow } from 'electron'
import { basename, join } from 'path'
import { stat } from 'fs/promises'
import { createProject, listTree, readDoc, requireCurrentRoot, writeDoc } from './projectFs'
import { loadProjectProtection, setProtectedPaths } from './projectSettings'
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
import type { AppSettings, GrammarLint, ProjectInfo, ThemeSetting } from '../shared/types'

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

async function openProject(root: string): Promise<ProjectInfo> {
  if (!(await stat(root)).isDirectory()) throw new Error('Not a directory')
  const tree = await listTree(root)
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
