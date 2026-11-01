import { describe, expect, it } from 'vitest'
import { menuFor, TREE_MENU_LABELS } from './treeMenuItems'

describe('menuFor', () => {
  it('file menu never has Paste', () => {
    expect(menuFor({ kind: 'file', protectRule: 'protect', canPaste: true })).toEqual([
      'rename',
      '-',
      'duplicate',
      '-',
      'cut',
      'copy',
      '-',
      'reveal',
      '-',
      'trash',
      '-',
      'protect'
    ])
  })
  it('folder menu', () => {
    expect(menuFor({ kind: 'folder', protectRule: 'none', canPaste: false })).toEqual([
      'new-file',
      'new-folder',
      '-',
      'rename',
      '-',
      'cut',
      'copy',
      '-',
      'reveal',
      '-',
      'trash'
    ])
  })
  it('folder menu with paste', () => {
    expect(menuFor({ kind: 'folder', protectRule: 'unprotect', canPaste: true })).toEqual([
      'new-file',
      'new-folder',
      '-',
      'rename',
      '-',
      'cut',
      'copy',
      'paste',
      '-',
      'reveal',
      '-',
      'trash',
      '-',
      'unprotect'
    ])
  })
  it('empty space', () => {
    expect(menuFor({ kind: 'empty', protectRule: 'none', canPaste: true })).toEqual([
      'new-file',
      'new-folder',
      '-',
      'paste'
    ])
    expect(menuFor({ kind: 'empty', protectRule: 'none', canPaste: false })).toEqual([
      'new-file',
      'new-folder'
    ])
  })
  it('multi-selection', () => {
    expect(menuFor({ kind: 'multi', protectRule: 'unprotect', canPaste: false })).toEqual([
      'cut',
      'copy',
      '-',
      'trash',
      '-',
      'unprotect'
    ])
  })
})

describe('labels', () => {
  it('uses the exact wording', () => {
    expect(TREE_MENU_LABELS.reveal).toBe('Reveal in Finder')
    expect(TREE_MENU_LABELS.trash).toBe('Move to Trash')
    expect(TREE_MENU_LABELS.protect).toBe('Protect from AI edits')
    expect(TREE_MENU_LABELS.unprotect).toBe('Stop protecting')
  })
})
