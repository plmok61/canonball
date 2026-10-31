import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'

type Level = 0 | 1 | 2 | 3

export function Toolbar({
  editor,
  isProse
}: {
  editor: Editor
  isProse: boolean
}): React.JSX.Element {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      quote: e.isActive('blockquote'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      level: ([1, 2, 3] as const).find((l) => e.isActive('heading', { level: l })) ?? 0
    })
  })

  const setLevel = (level: Level): void => {
    const chain = editor.chain().focus()
    if (level === 0) chain.setParagraph().run()
    else chain.setHeading({ level }).run()
  }

  // mousedown preventDefault keeps the editor selection while clicking buttons
  const btn = (label: string, active: boolean, run: () => void): React.JSX.Element => (
    <button
      type="button"
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {label}
    </button>
  )

  return (
    <div className="cb-toolbar" role="toolbar" aria-label="Formatting">
      {btn('Bold', s.bold, () => editor.chain().focus().toggleBold().run())}
      {btn('Italic', s.italic, () => editor.chain().focus().toggleItalic().run())}
      <select
        aria-label="Heading"
        value={s.level}
        onChange={(e) => setLevel(Number(e.target.value) as Level)}
      >
        <option value={0}>Normal</option>
        <option value={1}>Heading 1</option>
        <option value={2}>Heading 2</option>
        <option value={3}>Heading 3</option>
      </select>
      {btn('Quote', s.quote, () => editor.chain().focus().toggleBlockquote().run())}
      {btn('Bullet list', s.bullet, () => editor.chain().focus().toggleBulletList().run())}
      {btn('Numbered list', s.ordered, () => editor.chain().focus().toggleOrderedList().run())}
      {btn('Scene break', false, () => editor.chain().focus().setHorizontalRule().run())}
      {isProse && <span className="cb-draft-banner">Draft — AI won&apos;t edit</span>}
    </div>
  )
}
