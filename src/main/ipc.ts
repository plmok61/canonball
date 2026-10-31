import { app, dialog, ipcMain, nativeTheme, BrowserWindow } from 'electron'
import { basename, join } from 'path'
import { stat } from 'fs/promises'
import { createProject, listTree, readDoc, requireCurrentRoot, writeDoc } from './projectFs'
import { loadProjectAccess, setPathAccess, setProsePaths } from './projectSettings'
import { createSettingsStore, type SettingsStore } from './appSettings'
import { parseLintRequest } from './grammar/grammarService'
import type { Access, AppSettings, GrammarLint, ProjectInfo } from '../shared/types'

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

function isAccess(a: unknown): a is Access {
  return a === 'edit' || a === 'read' || a === 'hidden'
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
  currentRoot = root
  await updateSettings({ lastProjectRoot: root })
  return { root, name: basename(root), tree, access: await loadProjectAccess(root) }
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
  ipcMain.handle('canonball:getProjectAccess', () => loadProjectAccess(requireRoot()))
  ipcMain.handle(
    'canonball:setPathAccess',
    (_e, root: string, relPath: unknown, access: unknown) => {
      const r = requireCurrentRoot(currentRoot, root)
      if (typeof relPath !== 'string' || !isAccess(access)) throw new Error('Invalid argument')
      return setPathAccess(r, relPath, access)
    }
  )
  ipcMain.handle('canonball:setProsePaths', (_e, root: string, prose: unknown) => {
    const r = requireCurrentRoot(currentRoot, root)
    if (!Array.isArray(prose) || !prose.every((p) => typeof p === 'string')) {
      throw new Error('Invalid argument')
    }
    return setProsePaths(r, prose)
  })
  ipcMain.handle('canonball:lintGrammar', (_e, texts: unknown) =>
    grammar.lint(parseLintRequest(texts))
  )
  ipcMain.handle('canonball:getSettings', () => settings().load())
  ipcMain.handle('canonball:setSettings', (_e, patch: Partial<AppSettings>) =>
    updateSettings(patch)
  )
}
