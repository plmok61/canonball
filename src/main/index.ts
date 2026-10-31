import { app, dialog, shell, BrowserWindow, ipcMain, Menu, utilityProcess } from 'electron'
import { join } from 'path'
import { applyStoredTheme, registerIpc } from './ipc'
import { createCloseHandler, type FlushResult } from './closeFlush'
import { buildMenuTemplate } from './menu'
import { buildContextMenuTemplate } from './contextMenu'
import { isSafeExternalUrl } from './navigation'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { createGrammarService } from './grammar/grammarService'
import grammarWorkerPath from './grammar/grammarWorker?modulePath'
import icon from '../../resources/icon.png?asset'

let quitting = false

const grammar = createGrammarService(() =>
  utilityProcess.fork(grammarWorkerPath, [], { serviceName: 'Canonball Grammar' })
)

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true
    }
  })

  // Close-flush handshake: let the renderer save pending edits before closing.
  mainWindow.on(
    'close',
    createCloseHandler({
      requestFlush: () => mainWindow.webContents.send('canonball:flush-request'),
      onFlushDone: (cb) => {
        const listener = (e: Electron.IpcMainEvent, result?: FlushResult): void => {
          if (e.sender !== mainWindow.webContents) return
          cb(typeof result?.ok === 'boolean' ? result : { ok: false, error: 'Invalid reply' })
        }
        ipcMain.on('canonball:flush-done', listener)
        return () => ipcMain.removeListener('canonball:flush-done', listener)
      },
      setTimer: (cb) => {
        const t = setTimeout(cb, 3000)
        return () => clearTimeout(t)
      },
      confirmQuitAnyway: async (detail) => {
        if (mainWindow.isDestroyed()) return true
        const { response } = await dialog.showMessageBox(mainWindow, {
          type: 'warning',
          message: "Some changes couldn't be saved.",
          detail,
          buttons: ['Quit Anyway', 'Cancel'],
          defaultId: 1,
          cancelId: 1
        })
        return response === 0
      },
      closeWindow: () => {
        if (!mainWindow.isDestroyed()) mainWindow.close()
      },
      quitApp: () => app.quit(),
      isQuitting: () => quitting,
      cancelQuit: () => {
        quitting = false
      }
    })
  )

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // The window only ever shows the app. Navigating away (a file dropped from
  // Finder, a clicked link) would tear the renderer down without the flush
  // handshake, so refuse every navigation; safe links open in the system.
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault())
  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (isSafeExternalUrl(details.url)) void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Right-click: spelling suggestions (Chromium flags, the writer applies) and
  // cut/copy/paste. No menu when there is nothing to offer.
  mainWindow.webContents.on('context-menu', (_e, params) => {
    const wc = mainWindow.webContents
    const template = buildContextMenuTemplate(params, {
      replaceMisspelling: (w) => wc.replaceMisspelling(w),
      learnWord: (w) => wc.session.addWordToSpellCheckerDictionary(w)
    })
    if (template.length > 0) Menu.buildFromTemplate(template).popup({ window: mainWindow })
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('before-quit', () => {
  quitting = true
})

app.on('will-quit', () => grammar.dispose())

app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.canonball.app')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpc(grammar)
  await applyStoredTheme()

  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      buildMenuTemplate({
        isMac: process.platform === 'darwin',
        isDev: is.dev,
        send: (command) => {
          const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
          win?.webContents.send('canonball:menu', command)
        }
      })
    )
  )

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
