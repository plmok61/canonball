import type { MenuItemConstructorOptions } from 'electron'

export interface ContextMenuParams {
  misspelledWord: string
  dictionarySuggestions: string[]
  isEditable: boolean
  selectionText: string
  editFlags: { canCut: boolean; canCopy: boolean; canPaste: boolean }
}

export interface SpellActions {
  replaceMisspelling(word: string): void
  learnWord(word: string): void
}

const MAX_SUGGESTIONS = 5

export function buildContextMenuTemplate(
  p: ContextMenuParams,
  a: SpellActions
): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = []
  if (p.misspelledWord) {
    const suggestions = p.dictionarySuggestions.slice(0, MAX_SUGGESTIONS)
    if (suggestions.length === 0) {
      items.push({ label: 'No Guesses Found', enabled: false })
    }
    for (const s of suggestions) {
      items.push({ label: s, click: () => a.replaceMisspelling(s) })
    }
    items.push({ label: 'Learn Spelling', click: () => a.learnWord(p.misspelledWord) })
    items.push({ type: 'separator' })
  }
  if (p.isEditable) {
    items.push(
      { role: 'cut', enabled: p.editFlags.canCut },
      { role: 'copy', enabled: p.editFlags.canCopy },
      { role: 'paste', enabled: p.editFlags.canPaste }
    )
  } else if (p.selectionText) {
    items.push({ role: 'copy' })
  }
  return items
}
