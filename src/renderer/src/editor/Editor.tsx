import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import type { Editor as TipTapEditor } from '@tiptap/core'
import { Grammar } from '../grammar/grammarExtension'
import { GrammarPopover } from '../grammar/GrammarPopover'
import { Autosave } from './autosave'
import { createExtensions } from './extensions'
import { loadIntoEditor, serializeEditor, type OpenDoc } from './markdown'
import { flushAll, orphan, registerLive, settleOrphan } from './saveRegistry'
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

interface EditorProps {
  /** The project this file belongs to; every save is checked against it. */
  root: string
  relPath: string
  /** Whether the project's settings mark this file as prose (shows the draft banner). */
  isProse: boolean
}

export function Editor({ root, relPath, isProse }: EditorProps): React.JSX.Element {
  // A fresh instance per file keeps load, autosave and flush scoped to one path.
  return <FileEditor key={`${root}\0${relPath}`} root={root} relPath={relPath} isProse={isProse} />
}

function FileEditor({ root, relPath, isProse }: EditorProps): React.JSX.Element {
  const extensions = useMemo(
    () => [
      ...createExtensions(),
      Grammar.configure({ lint: (t) => window.canonball.lintGrammar(t), delayMs: 500 })
    ],
    []
  )
  const [loaded, setLoaded] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [failed, setFailed] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const autosave = useRef<Autosave | null>(null)
  const doc = useRef<OpenDoc>({ frontMatter: null })
  const mtime = useRef(0)

  const makeAutosave = (initial: string): Autosave =>
    new Autosave({
      delayMs: DEBOUNCE_MS,
      initial,
      onDirtyChange: setDirty,
      onErrorChange: setFailed,
      save: async (content) => {
        const saved = await window.canonball.writeDoc(root, relPath, content)
        mtime.current = saved.mtimeMs
      }
    })

  const editor = useEditor({
    extensions,
    editable: false,
    immediatelyRender: false,
    editorProps: {
      attributes: { spellcheck: 'true', autocorrect: 'off', autocapitalize: 'off' }
    },
    onUpdate: ({ editor: e }) => {
      autosave.current?.change(serializeEditor(e, doc.current))
    }
  })

  useEffect(() => {
    if (!editor) return
    let cancelled = false
    settleOrphan(root, relPath)
      .then(async (adopted) => ({ adopted, file: await window.canonball.readDoc(relPath) }))
      .then(({ adopted, file }) => {
        if (cancelled || editor.isDestroyed) return
        mtime.current = file.mtimeMs
        if (adopted === null) {
          doc.current = loadIntoEditor(editor, file.content)
          // Baseline is the serialized form, so edit-then-undo never rewrites a
          // file whose round trip normalizes.
          autosave.current = makeAutosave(serializeEditor(editor, doc.current))
        } else {
          // A previous editor of this file could not save; keep its text and
          // keep it dirty so this editor writes it.
          doc.current = loadIntoEditor(editor, adopted)
          autosave.current = makeAutosave(file.content)
          autosave.current.change(adopted)
        }
        editor.setEditable(true, false)
        setLoaded(true)
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e))
      })
    window.canonball.onFlushRequest(() => flushAll(autosave.current))
    const unregister = registerLive(() => autosave.current)
    return () => {
      cancelled = true
      unregister()
      if (autosave.current) orphan(root, relPath, autosave.current)
    }
    // makeAutosave closes over root and relPath only, which are fixed for this instance
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, relPath])

  useEffect(() => {
    if (!editor || !loaded) return
    const onFocus = (): void => {
      if (autosave.current?.dirty) return
      void window.canonball
        .readDoc(relPath)
        .then((file) => {
          if (editor.isDestroyed || autosave.current?.dirty) return
          if (file.mtimeMs === mtime.current) return
          doc.current = loadIntoEditor(editor, file.content)
          mtime.current = file.mtimeMs
          autosave.current = makeAutosave(serializeEditor(editor, doc.current))
        })
        .catch(() => {
          // transient read failure: keep what is on screen, try again next focus
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
      {editor && <Toolbar editor={editor} isProse={isProse} />}
      {loadError ? (
        <p role="alert" className="cb-load-error">
          Couldn&apos;t open this file: {loadError}
        </p>
      ) : (
        <div className="cb-page-scroll">
          <EditorContent editor={editor} className="cb-page" />
          {editor && <GrammarPopover editor={editor} />}
        </div>
      )}
      <div className="cb-status">
        <span>{relPath}</span>
        <span>{words === 1 ? '1 word' : `${words} words`}</span>
        <span className={failed ? 'cb-status-failed' : undefined}>
          {failed ? 'not saved — retrying' : dirty ? 'saving…' : 'saved'}
        </span>
      </div>
    </div>
  )
}
