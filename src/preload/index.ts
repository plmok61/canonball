import { contextBridge, ipcRenderer } from 'electron'
import type { CanonballApi, FlushResult, MenuCommand } from '../shared/types'

let flushHandler: (() => Promise<void>) | null = null

ipcRenderer.on('canonball:flush-request', async () => {
  let result: FlushResult = { ok: true }
  try {
    if (flushHandler) await flushHandler()
  } catch (e) {
    result = { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  ipcRenderer.send('canonball:flush-done', result)
})

const api: CanonballApi = {
  openProjectDialog: () => ipcRenderer.invoke('canonball:openProjectDialog'),
  newProjectDialog: () => ipcRenderer.invoke('canonball:newProjectDialog'),
  openProject: (root) => ipcRenderer.invoke('canonball:openProject', root),
  refreshTree: () => ipcRenderer.invoke('canonball:refreshTree'),
  readDoc: (relPath) => ipcRenderer.invoke('canonball:readDoc', relPath),
  writeDoc: (root, relPath, content) =>
    ipcRenderer.invoke('canonball:writeDoc', root, relPath, content),
  getSettings: () => ipcRenderer.invoke('canonball:getSettings'),
  setSettings: (patch) => ipcRenderer.invoke('canonball:setSettings', patch),
  lintGrammar: (texts) => ipcRenderer.invoke('canonball:lintGrammar', texts),
  onFlushRequest: (handler) => {
    flushHandler = handler
  },
  onMenuCommand: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, command: MenuCommand): void => handler(command)
    ipcRenderer.on('canonball:menu', listener)
    return () => {
      ipcRenderer.removeListener('canonball:menu', listener)
    }
  }
}

contextBridge.exposeInMainWorld('canonball', api)
