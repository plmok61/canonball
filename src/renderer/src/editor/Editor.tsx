import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import type { Editor as TipTapEditor } from '@tiptap/core'
import { Autosave } from './autosave'
import { createExtensions } from './extensions'
import { loadIntoEditor, serializeEditor, type OpenDoc } from './markdown'
import { Toolbar } from './Toolbar'
import { countWords } from './wordCount'
import './editor.css'

const DEBOUNCE_MS = 800

function visibleWords(editor: TipTapEditor): number {
  // Atoms (hints, raw HTML) are leaves; their text is not prose.
  const text = editor.state.doc.textBetween(0, editor.state.doc.content.size, ' ', (node) =>
    node.type.name === 'hardBreak' ? ' ' : ''
  )
  return countWords(text)
}

export function Editor({ relPath }: { relPath: string }): React.JSX.Element {
  // A fresh instance per file keeps load, autosave and flush scoped to one path.
  return <FileEditor key={relPath} relPath={relPath} />
}

function FileEditor({ relPath }: { relPath: string }): React.JSX.Element {
  const extensions = useMemo(() => createExtensions(), [])
  const [loaded, setLoaded] = useState(false)
  const [dirty, setDirty] = useState(false)
  const autosave = useRef<Autosave | null>(null)
  const doc = useRef<OpenDoc>({ frontMatter: null })
  const mtime = useRef(0)

  const makeAutosave = (initial: string): Autosave =>
    new Autosave({
      delayMs: DEBOUNCE_MS,
      initial,
      onDirtyChange: setDirty,
      save: async (content) => {
        const saved = await window.canonball.writeDoc(relPath, content)
        mtime.current = saved.mtimeMs
      }
    })

  const editor = useEditor({
    extensions,
    editable: false,
    immediatelyRender: false,
    onUpdate: ({ editor: e }) => {
      autosave.current?.change(serializeEditor(e, doc.current))
    }
  })

  useEffect(() => {
    if (!editor) return
    let cancelled = false
    void window.canonball.readDoc(relPath).then((file) => {
      if (cancelled || editor.isDestroyed) return
      doc.current = loadIntoEditor(editor, file.content)
      mtime.current = file.mtimeMs
      autosave.current = makeAutosave(file.content)
      editor.setEditable(true, false)
      setLoaded(true)
    })
    window.canonball.onFlushRequest(async () => {
      await autosave.current?.flush()
    })
    return () => {
      cancelled = true
      void autosave.current?.flush().catch(() => {})
    }
    // makeAutosave closes over relPath only, which is fixed for this instance
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, relPath])

  useEffect(() => {
    if (!editor || !loaded) return
    const onFocus = (): void => {
      if (autosave.current?.dirty) return
      void window.canonball.readDoc(relPath).then((file) => {
        if (editor.isDestroyed || autosave.current?.dirty) return
        if (file.mtimeMs === mtime.current) return
        doc.current = loadIntoEditor(editor, file.content)
        mtime.current = file.mtimeMs
        autosave.current = makeAutosave(file.content)
      })
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, loaded, relPath])

  const words =
    useEditorState({
      editor,
      selector: ({ editor: e }) => (e ? visibleWords(e) : 0)
    }) ?? 0

  return (
    <div className="cb-editor">
      {editor && <Toolbar editor={editor} relPath={relPath} />}
      <div className="cb-page-scroll">
        <EditorContent editor={editor} className="cb-page" />
      </div>
      <div className="cb-status">
        <span>{relPath}</span>
        <span>{words === 1 ? '1 word' : `${words} words`}</span>
        <span>{dirty ? 'saving…' : 'saved'}</span>
      </div>
    </div>
  )
}
