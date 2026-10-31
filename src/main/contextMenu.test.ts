import { describe, expect, it, vi, type Mock } from 'vitest'
import { buildContextMenuTemplate, type ContextMenuParams } from './contextMenu'

function params(over: Partial<ContextMenuParams> = {}): ContextMenuParams {
  return {
    misspelledWord: '',
    dictionarySuggestions: [],
    isEditable: false,
    selectionText: '',
    editFlags: { canCut: true, canCopy: false, canPaste: true },
    ...over
  }
}

function actions(): {
  replaceMisspelling: Mock<(w: string) => void>
  learnWord: Mock<(w: string) => void>
} {
  return { replaceMisspelling: vi.fn(), learnWord: vi.fn() }
}

describe('buildContextMenuTemplate', () => {
  it('offers at most five suggestions that replace the misspelling', () => {
    const a = actions()
    const sugg = ['s1', 's2', 's3', 's4', 's5', 's6', 's7']
    const t = buildContextMenuTemplate(
      params({ misspelledWord: 'wrd', dictionarySuggestions: sugg }),
      a
    )
    expect(t.slice(0, 5).map((i) => i.label)).toEqual(sugg.slice(0, 5))
    expect(t[5].label).toBe('Learn Spelling')
    ;(t[1].click as () => void)()
    expect(a.replaceMisspelling).toHaveBeenCalledWith('s2')
  })

  it('says No Guesses Found when there are no suggestions', () => {
    const t = buildContextMenuTemplate(params({ misspelledWord: 'wrd' }), actions())
    expect(t[0]).toMatchObject({ label: 'No Guesses Found', enabled: false })
  })

  it('Learn Spelling adds the word to the dictionary', () => {
    const a = actions()
    const t = buildContextMenuTemplate(params({ misspelledWord: 'wrd' }), a)
    ;(t.find((i) => i.label === 'Learn Spelling')!.click as () => void)()
    expect(a.learnWord).toHaveBeenCalledWith('wrd')
    expect(t[t.length - 1]).toEqual({ type: 'separator' })
  })

  it('editable fields get cut, copy and paste, enabled per editFlags', () => {
    const t = buildContextMenuTemplate(params({ isEditable: true }), actions())
    expect(t).toEqual([
      { role: 'cut', enabled: true },
      { role: 'copy', enabled: false },
      { role: 'paste', enabled: true }
    ])
  })

  it('read-only selections get copy only', () => {
    const t = buildContextMenuTemplate(params({ selectionText: 'hi' }), actions())
    expect(t).toEqual([{ role: 'copy' }])
  })

  it('no misspelling, not editable, no selection: empty menu', () => {
    expect(buildContextMenuTemplate(params(), actions())).toEqual([])
  })
})
