import { contextBridge, ipcRenderer } from 'electron'
import type { CanonballApi } from '../shared/types'

let flushHandler: (() => Promise<void>) | null = null

ipcRenderer.on('canonball:flush-request', async () => {
  try {
    if (flushHandler) await flushHandler()
  } finally {
    ipcRenderer.send('canonball:flush-done')
  }
})

const api: CanonballApi = {
  openProjectDialog: () => ipcRenderer.invoke('canonball:openProjectDialog'),
  newProjectDialog: () => ipcRenderer.invoke('canonball:newProjectDialog'),
  openProject: (root) => ipcRenderer.invoke('canonball:openProject', root),
  refreshTree: () => ipcRenderer.invoke('canonball:refreshTree'),
  readDoc: (relPath) => ipcRenderer.invoke('canonball:readDoc', relPath),
  writeDoc: (relPath, content) => ipcRenderer.invoke('canonball:writeDoc', relPath, content),
  getSettings: () => ipcRenderer.invoke('canonball:getSettings'),
  setSettings: (patch) => ipcRenderer.invoke('canonball:setSettings', patch),
  onFlushRequest: (handler) => {
    flushHandler = handler
  }
}

contextBridge.exposeInMainWorld('canonball', api)
