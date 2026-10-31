import { app, dialog, ipcMain, nativeTheme, BrowserWindow } from 'electron'
import { basename, join } from 'path'
import { stat } from 'fs/promises'
import { createProject, listTree, readDoc, writeDoc } from './projectFs'
import { loadSettings, saveSettings } from './appSettings'
import type { AppSettings, ProjectInfo } from '../shared/types'

let currentRoot: string | null = null

function templateDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'template')
    : join(app.getAppPath(), 'template')
}

function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function requireRoot(): string {
  if (!currentRoot) throw new Error('No project open')
  return currentRoot
}

async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const next = { ...(await loadSettings(settingsFile())), ...patch }
  await saveSettings(settingsFile(), next)
  if ('theme' in patch) nativeTheme.themeSource = next.theme
  return next
}

async function openProject(root: string): Promise<ProjectInfo> {
  if (!(await stat(root)).isDirectory()) throw new Error('Not a directory')
  const tree = await listTree(root)
  currentRoot = root
  await updateSettings({ lastProjectRoot: root })
  return { root, name: basename(root), tree }
}

/** Apply the stored theme to native chrome before the window shows, to avoid a flash. */
export async function applyStoredTheme(): Promise<void> {
  nativeTheme.themeSource = (await loadSettings(settingsFile())).theme
}

export function registerIpc(): void {
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
  ipcMain.handle('canonball:writeDoc', (_e, relPath: string, content: string) =>
    writeDoc(requireRoot(), relPath, content)
  )
  ipcMain.handle('canonball:getSettings', () => loadSettings(settingsFile()))
  ipcMain.handle('canonball:setSettings', (_e, patch: Partial<AppSettings>) =>
    updateSettings(patch)
  )
}
