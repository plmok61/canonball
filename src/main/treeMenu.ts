import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { TREE_MENU_LABELS, type TreeMenuItem } from '../shared/treeMenuItems'

export function buildTreeMenuTemplate(
  items: (TreeMenuItem | '-')[],
  choose: (item: TreeMenuItem) => void
): MenuItemConstructorOptions[] {
  return items.map((item) =>
    item === '-'
      ? { type: 'separator' }
      : { label: TREE_MENU_LABELS[item], click: () => choose(item) }
  )
}

/** Pops the menu. Resolves the clicked item, or null if the menu closed without a choice. */
export function showTreeMenu(
  win: BrowserWindow,
  items: (TreeMenuItem | '-')[]
): Promise<TreeMenuItem | null> {
  return new Promise((resolve) => {
    let settled = false
    const settle = (chosen: TreeMenuItem | null): void => {
      if (settled) return
      settled = true
      resolve(chosen)
    }
    const menu = Menu.buildFromTemplate(buildTreeMenuTemplate(items, (item) => settle(item)))
    // Electron may call the close callback before the item's click, so let a click win.
    menu.popup({ window: win, callback: () => setTimeout(() => settle(null), 0) })
  })
}
