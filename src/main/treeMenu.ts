import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import type { TreeMenuKind } from '../shared/types'

const LABELS: Record<TreeMenuKind, string> = {
  protect: 'Protect from AI edits',
  unprotect: 'Stop protecting'
}

export function buildTreeMenuTemplate(
  kind: TreeMenuKind,
  choose: () => void
): MenuItemConstructorOptions[] {
  return [{ label: LABELS[kind], click: () => choose() }]
}

/** Pops the one-item menu. Resolves true if the item was clicked, false if the menu closed without a choice. */
export function showTreeMenu(win: BrowserWindow, kind: TreeMenuKind): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const settle = (chosen: boolean): void => {
      if (settled) return
      settled = true
      resolve(chosen)
    }
    const menu = Menu.buildFromTemplate(buildTreeMenuTemplate(kind, () => settle(true)))
    // Electron may call the close callback before the item's click, so let a click win.
    menu.popup({ window: win, callback: () => setTimeout(() => settle(false), 0) })
  })
}
