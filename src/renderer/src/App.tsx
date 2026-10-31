import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectInfo, TreeNode } from '../../shared/types'
import ChatPlaceholder from './chat/ChatPlaceholder'
import { Editor } from './editor/Editor'
import { flushAll } from './editor/saveRegistry'
import { FileTree } from './tree/FileTree'
import { sortTree } from './tree/sortTree'
import { ThemePicker } from './theme/ThemePicker'
import { useTheme } from './theme/useTheme'

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function App(): React.JSX.Element {
  const { theme, setTheme } = useTheme()
  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [refreshed, setRefreshed] = useState<{ root: string; tree: TreeNode[] } | null>(null)
  const switching = useRef(false)

  /**
   * Open or create a project. Everything typed so far is saved first; if that
   * fails the current project stays open, so no text is left behind.
   */
  const switchProject = useCallback(
    async (pick: () => Promise<ProjectInfo | null>): Promise<void> => {
      if (switching.current) return
      switching.current = true
      setError(null)
      setPending(true)
      try {
        try {
          await flushAll()
        } catch (e) {
          setError(`Couldn't save your changes, so the project was not switched: ${message(e)}`)
          return
        }
        const info = await pick()
        if (info) {
          setSelectedPath(null)
          setRefreshed(null)
          setProject(info)
        }
      } catch (e) {
        setError(message(e))
      } finally {
        switching.current = false
        setPending(false)
      }
    },
    []
  )

  useEffect(
    () =>
      window.canonball.onMenuCommand((command) => {
        void switchProject(
          command === 'open-project'
            ? () => window.canonball.openProjectDialog()
            : () => window.canonball.newProjectDialog()
        )
      }),
    [switchProject]
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { lastProjectRoot } = await window.canonball.getSettings()
        if (lastProjectRoot) {
          const info = await window.canonball.openProject(lastProjectRoot)
          if (!cancelled) setProject(info)
        }
      } catch {
        // last project missing or unreadable: fall through to the welcome screen
      }
      if (!cancelled) setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const root = project?.root
  useEffect(() => {
    if (!root) return
    const refresh = (): void => {
      window.canonball
        .refreshTree()
        .then((t) => setRefreshed({ root, tree: t }))
        .catch(() => {
          // keep the last known tree
        })
    }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [root])

  const tree = refreshed && refreshed.root === project?.root ? refreshed.tree : project?.tree
  const sorted = useMemo(() => sortTree(tree ?? []), [tree])

  if (!ready) return <div className="app" />

  if (!project) {
    const pick = switchProject
    return (
      <div className="welcome" data-testid="welcome">
        <h1>Canonball</h1>
        <button disabled={pending} onClick={() => pick(() => window.canonball.openProjectDialog())}>
          Open Project…
        </button>
        <button disabled={pending} onClick={() => pick(() => window.canonball.newProjectDialog())}>
          New Project…
        </button>
        {error && <p role="alert">{error}</p>}
      </div>
    )
  }

  return (
    <div className="app">
      <aside data-testid="tree-panel">
        {error && (
          <p role="alert" className="cb-app-error">
            {error}
          </p>
        )}
        <FileTree tree={sorted} selected={selectedPath} onOpen={setSelectedPath} />
        <footer className="cb-tree-footer">
          <ThemePicker value={theme} onChange={setTheme} />
        </footer>
      </aside>
      <main data-testid="editor-panel">
        {selectedPath ? (
          <Editor root={project.root} relPath={selectedPath} />
        ) : (
          <p className="editor-empty">Choose a file from the project</p>
        )}
      </main>
      <aside data-testid="chat-panel">
        <ChatPlaceholder />
      </aside>
    </div>
  )
}

export default App
