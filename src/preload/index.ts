import { contextBridge, ipcRenderer } from 'electron'
import type { CanonballApi, FlushResult, MenuCommand } from '../shared/types'
import type { ChatEvent } from '../shared/ai'
import { cleanIpcError } from '../shared/ipcError'

/** Every call to main goes through here, so the renderer sees main's message, not Electron's wrapper. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (channel: string, ...args: unknown[]): Promise<any> =>
  ipcRenderer.invoke(channel, ...args).catch((e: unknown) => {
    throw cleanIpcError(e)
  })

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
  openProjectDialog: () => invoke('canonball:openProjectDialog'),
  newProjectDialog: () => invoke('canonball:newProjectDialog'),
  openProject: (root) => invoke('canonball:openProject', root),
  refreshTree: () => invoke('canonball:refreshTree'),
  readDoc: (relPath) => invoke('canonball:readDoc', relPath),
  writeDoc: (root, relPath, content) => invoke('canonball:writeDoc', root, relPath, content),
  getSettings: () => invoke('canonball:getSettings'),
  setSettings: (patch) => invoke('canonball:setSettings', patch),
  getProjectProtection: () => invoke('canonball:getProjectProtection'),
  setProtectedPaths: (root, paths) => invoke('canonball:setProtectedPaths', root, paths),
  showTreeMenu: (items) => invoke('canonball:showTreeMenu', items),
  confirmDialog: (opts) => invoke('canonball:confirmDialog', opts),
  nativeUndo: () => {
    void invoke('canonball:nativeUndo')
  },
  nativeRedo: () => {
    void invoke('canonball:nativeRedo')
  },
  createEntry: (root, kind, parentRel, name) =>
    invoke('canonball:createEntry', root, kind, parentRel, name),
  renameEntry: (root, relPath, newName) => invoke('canonball:renameEntry', root, relPath, newName),
  pasteEntries: (root, mode, relPaths, destRel) =>
    invoke('canonball:pasteEntries', root, mode, relPaths, destRel),
  duplicateEntries: (root, relPaths) => invoke('canonball:duplicateEntries', root, relPaths),
  moveExact: (root, moves, restoreProtected) =>
    invoke('canonball:moveExact', root, moves, restoreProtected),
  trashEntries: (root, relPaths) => invoke('canonball:trashEntries', root, relPaths),
  restoreEntries: (root, items) => invoke('canonball:restoreEntries', root, items),
  removeCreated: (root, relPaths) => invoke('canonball:removeCreated', root, relPaths),
  changeProtectionMany: (root, kind, relPaths) =>
    invoke('canonball:changeProtectionMany', root, kind, relPaths),
  applyProtectionDelta: (root, delta) => invoke('canonball:applyProtectionDelta', root, delta),
  revealEntry: (root, relPath) => invoke('canonball:revealEntry', root, relPath),
  lintGrammar: (texts) => invoke('canonball:lintGrammar', texts),
  onFlushRequest: (handler) => {
    flushHandler = handler
  },
  onMenuCommand: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, command: MenuCommand): void => handler(command)
    ipcRenderer.on('canonball:menu', listener)
    return () => {
      ipcRenderer.removeListener('canonball:menu', listener)
    }
  },
  getAiStatus: () => invoke('canonball:getAiStatus'),
  setApiKey: (provider, key) => invoke('canonball:setApiKey', provider, key),
  setLocalUrl: (url) => invoke('canonball:setLocalUrl', url),
  setModel: (choice) => invoke('canonball:setModel', choice),
  listModels: () => invoke('canonball:listModels'),
  startChat: (req) => invoke('canonball:startChat', req),
  cancelChat: (requestId) => invoke('canonball:cancelChat', requestId),
  applyProposal: (root, id) => invoke('canonball:applyProposal', root, id),
  rejectProposal: (id) => invoke('canonball:rejectProposal', id),
  listChats: () => invoke('canonball:listChats'),
  loadChat: (id) => invoke('canonball:loadChat', id),
  saveChat: (root, thread) => invoke('canonball:saveChat', root, thread),
  onChatEvent: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, event: ChatEvent): void => handler(event)
    ipcRenderer.on('canonball:chatEvent', listener)
    return () => {
      ipcRenderer.removeListener('canonball:chatEvent', listener)
    }
  }
}

contextBridge.exposeInMainWorld('canonball', api)
