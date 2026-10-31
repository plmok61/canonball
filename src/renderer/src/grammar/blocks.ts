import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

export interface TextBlock {
  text: string
  /** length text.length + 1; offsets[i] = doc position of char i, last = block content end */
  offsets: number[]
  /** length text.length; true for chars that stand in for non-prose */
  masked: boolean[]
}

/** One TextBlock per textblock node (except code blocks), with a map back to doc positions. */
export function collectBlocks(doc: ProseMirrorNode): TextBlock[] {
  const blocks: TextBlock[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'codeBlock') return false
    if (!node.isTextblock) return true

    const start = pos + 1
    let text = ''
    const offsets: number[] = []
    const masked: boolean[] = []

    node.forEach((child, childOffset) => {
      const at = start + childOffset
      if (child.isText) {
        const value = child.text ?? ''
        const isCode = child.marks.some((m) => m.type.name === 'code')
        for (let i = 0; i < value.length; i++) {
          text += isCode ? ' ' : value[i]
          offsets.push(at + i)
          masked.push(isCode)
        }
      } else if (child.type.name === 'hardBreak') {
        text += '\n'
        offsets.push(at)
        masked.push(false)
      } else if (child.isLeaf) {
        text += ' '
        offsets.push(at)
        masked.push(true)
      }
    })

    offsets.push(start + node.content.size)
    blocks.push({ text, offsets, masked })
    return false
  })
  return blocks
}

/** Doc range for a lint span, or null if the span is empty or touches a masked char. */
export function toDocRange(
  block: TextBlock,
  start: number,
  end: number
): { from: number; to: number } | null {
  if (start < 0 || end > block.text.length || end <= start) return null
  for (let i = start; i < end; i++) if (block.masked[i]) return null
  return { from: block.offsets[start], to: block.offsets[end - 1] + 1 }
}
