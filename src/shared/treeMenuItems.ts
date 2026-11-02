export type TreeMenuItem =
  | 'new-file'
  | 'new-folder'
  | 'rename'
  | 'duplicate'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'reveal'
  | 'trash'
  | 'protect'
  | 'unprotect'

export const TREE_MENU_LABELS: Record<TreeMenuItem, string> = {
  'new-file': 'New File',
  'new-folder': 'New Folder',
  rename: 'Rename',
  duplicate: 'Duplicate',
  cut: 'Cut',
  copy: 'Copy',
  paste: 'Paste',
  reveal: 'Reveal in Finder',
  trash: 'Move to Trash',
  protect: 'Protect from AI edits',
  unprotect: 'Stop protecting'
}

export interface MenuTarget {
  kind: 'file' | 'folder' | 'empty' | 'multi'
  protectRule: 'protect' | 'unprotect' | 'none'
  canPaste: boolean
}

type Entry = TreeMenuItem | '-'

/** The menu's items in order; groups are separated by '-', and empty groups vanish. */
export function menuFor(t: MenuTarget): Entry[] {
  const groups: TreeMenuItem[][] = []
  const folderish = t.kind === 'folder' || t.kind === 'empty'
  if (folderish) groups.push(['new-file', 'new-folder'])
  if (t.kind === 'file' || t.kind === 'folder') groups.push(['rename'])
  if (t.kind === 'file') groups.push(['duplicate'])
  if (t.kind !== 'empty') {
    const clip: TreeMenuItem[] = ['cut', 'copy']
    if (t.kind === 'folder' && t.canPaste) clip.push('paste')
    groups.push(clip)
  } else if (t.canPaste) {
    groups.push(['paste'])
  }
  if (t.kind === 'file' || t.kind === 'folder') groups.push(['reveal'])
  if (t.kind !== 'empty') groups.push(['trash'])
  if (t.kind !== 'empty' && t.protectRule !== 'none') groups.push([t.protectRule])
  return groups.flatMap((g, i) => (i === 0 ? g : (['-', ...g] as Entry[])))
}
