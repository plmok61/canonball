import { describe, expect, it, vi } from 'vitest'

const popupMock = vi.hoisted(() => ({ build: vi.fn() }))
vi.mock('electron', () => ({ Menu: { buildFromTemplate: popupMock.build } }))

import { buildTreeMenuTemplate, showTreeMenu } from './treeMenu'

type Win = Parameters<typeof showTreeMenu>[0]
const win = {} as Win

describe('buildTreeMenuTemplate', () => {
  it('protect label, and click chooses', () => {
    const fn = vi.fn()
    const t = buildTreeMenuTemplate('protect', fn)
    expect(t).toHaveLength(1)
    expect(t[0].label).toBe('Protect from AI edits')
    ;(t[0].click as () => void)()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('unprotect label', () => {
    expect(buildTreeMenuTemplate('unprotect', vi.fn())[0].label).toBe('Stop protecting')
  })
})

describe('showTreeMenu', () => {
  it('resolves false when closed without a choice', async () => {
    popupMock.build.mockReturnValue({
      popup: ({ callback }: { callback: () => void }) => callback()
    })
    await expect(showTreeMenu(win, 'protect')).resolves.toBe(false)
  })

  it('resolves true when clicked even if the close callback came first', async () => {
    popupMock.build.mockImplementation((template: { click: () => void }[]) => ({
      popup: ({ callback }: { callback: () => void }) => {
        callback()
        template[0].click()
      }
    }))
    await expect(showTreeMenu(win, 'unprotect')).resolves.toBe(true)
  })
})
