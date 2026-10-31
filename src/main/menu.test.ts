import { expect, it, vi } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import { buildMenuTemplate } from './menu'

function items(template: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return template.flatMap((m) => [m, ...((m.submenu as MenuItemConstructorOptions[]) ?? [])])
}

it('File menu sends Open Project and New Project to the renderer', () => {
  const send = vi.fn()
  const all = items(buildMenuTemplate({ isMac: true, isDev: false, send }))
  const open = all.find((i) => i.label === 'Open Project…')!
  const create = all.find((i) => i.label === 'New Project…')!
  expect(open.accelerator).toBe('CmdOrCtrl+O')
  expect(create.accelerator).toBe('CmdOrCtrl+Shift+N')
  ;(open.click as () => void)()
  ;(create.click as () => void)()
  expect(send.mock.calls).toEqual([['open-project'], ['new-project']])
})

it('File menu has Settings with Cmd+,', () => {
  const send = vi.fn()
  const all = items(buildMenuTemplate({ isMac: true, isDev: false, send }))
  const settings = all.find((i) => i.label === 'Settings…')!
  expect(settings.accelerator).toBe('CmdOrCtrl+,')
  ;(settings.click as () => void)()
  expect(send).toHaveBeenCalledWith('open-settings')
})

it('keeps the standard edit roles so editor shortcuts keep working', () => {
  const roles = items(buildMenuTemplate({ isMac: false, isDev: false, send: vi.fn() })).map(
    (i) => i.role
  )
  for (const role of ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'])
    expect(roles).toContain(role)
  expect(roles).toContain('windowMenu')
})

it('has a macOS app menu only on macOS', () => {
  expect(buildMenuTemplate({ isMac: true, isDev: false, send: vi.fn() })[0].role).toBe('appMenu')
  const other = buildMenuTemplate({ isMac: false, isDev: false, send: vi.fn() })
  expect(other.map((m) => m.role)).not.toContain('appMenu')
})

it('never offers a reload, which would drop unsaved text without the flush handshake', () => {
  const roles = items(buildMenuTemplate({ isMac: true, isDev: true, send: vi.fn() })).map(
    (i) => i.role
  )
  expect(roles).not.toContain('reload')
  expect(roles).not.toContain('forceReload')
})
