import { describe, expect, it, vi } from 'vitest'

const popupMock = vi.hoisted(() => ({ build: vi.fn() }))
vi.mock('electron', () => ({ Menu: { buildFromTemplate: popupMock.build } }))

import { buildTreeMenuTemplate, showTreeMenu } from './treeMenu'

type Win = Parameters<typeof showTreeMenu>[0]
const win = {} as Win

describe('buildTreeMenuTemplate', () => {
  it('labels items and separators, and a click chooses', () => {
    const choose = vi.fn()
    const t = buildTreeMenuTemplate(['rename', '-', 'trash'], choose)
    expect(t).toHaveLength(3)
    expect(t[0].label).toBe('Rename')
    expect(t[1].type).toBe('separator')
    expect(t[2].label).toBe('Move to Trash')
    ;(t[2].click as () => void)()
    expect(choose).toHaveBeenCalledWith('trash')
  })
})

describe('showTreeMenu', () => {
  it('resolves null when closed without a choice', async () => {
    popupMock.build.mockReturnValue({
      popup: ({ callback }: { callback: () => void }) => callback()
    })
    await expect(showTreeMenu(win, ['protect'])).resolves.toBeNull()
  })

  it('resolves the item when clicked even if the close callback came first', async () => {
    popupMock.build.mockImplementation((template: { click: () => void }[]) => ({
      popup: ({ callback }: { callback: () => void }) => {
        callback()
        template[0].click()
      }
    }))
    await expect(showTreeMenu(win, ['unprotect'])).resolves.toBe('unprotect')
  })
})
