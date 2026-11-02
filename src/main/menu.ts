import type { MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '../shared/types'

export interface MenuOptions {
  isMac: boolean
  isDev: boolean
  /** Deliver a command to the renderer, which flushes before acting on it. */
  send(command: MenuCommand): void
}

export function buildMenuTemplate({
  isMac,
  isDev,
  send
}: MenuOptions): MenuItemConstructorOptions[] {
  const file: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: () => send('open-project') },
      {
        label: 'New Project…',
        accelerator: 'CmdOrCtrl+Shift+N',
        click: () => send('new-project')
      },
      { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => send('open-settings') },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' }
    ]
  }
  // No reload/forceReload: reloading tears the renderer down without the
  // flush-before-close handshake.
  const view: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      ...(isDev ? [{ role: 'toggleDevTools' } as const, { type: 'separator' } as const] : []),
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' }
    ]
  }
  return [
    ...(isMac ? [{ role: 'appMenu' } as const] : []),
    file,
    {
      label: 'Edit',
      submenu: [
        // Routed by focus in the renderer: file undo in the tree, native text undo elsewhere.
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send('undo') },
        { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', click: () => send('redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' }
      ]
    },
    view,
    { role: 'windowMenu' }
  ]
}
