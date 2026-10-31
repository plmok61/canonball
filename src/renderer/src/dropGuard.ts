/**
 * Dropping a file anywhere the editor does not handle it would make the
 * browser navigate to that file, tearing the page down without saving. Cancel
 * the default for every drag and drop; the editor handles the drops it wants
 * before these window-level listeners run.
 */
export function guardDrops(win: Window): () => void {
  const onDragOver = (e: DragEvent): void => {
    if (e.defaultPrevented) return
    e.preventDefault()
    // Outside the editor, show that nothing can be dropped here.
    const target = e.target as Element | null
    if (e.dataTransfer && !target?.closest?.('[contenteditable="true"]')) {
      e.dataTransfer.dropEffect = 'none'
    }
  }
  const onDrop = (e: DragEvent): void => e.preventDefault()
  win.addEventListener('dragover', onDragOver)
  win.addEventListener('drop', onDrop)
  return () => {
    win.removeEventListener('dragover', onDragOver)
    win.removeEventListener('drop', onDrop)
  }
}
