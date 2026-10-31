import { useEffect, useMemo, useState } from 'react'
import type { ProjectInfo, TreeNode } from '../../shared/types'
import ChatPlaceholder from './chat/ChatPlaceholder'
import { Editor } from './editor/Editor'
import { FileTree } from './tree/FileTree'
import { sortTree } from './tree/sortTree'
import { ThemePicker } from './theme/ThemePicker'
import { useTheme } from './theme/useTheme'

function App(): React.JSX.Element {
  const { theme, setTheme } = useTheme()
  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [refreshed, setRefreshed] = useState<{ root: string; tree: TreeNode[] } | null>(null)

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
    const pick = async (fn: () => Promise<ProjectInfo | null>): Promise<void> => {
      setError(null)
      setPending(true)
      try {
        const info = await fn()
        if (info) setProject(info)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setPending(false)
      }
    }
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
        <FileTree tree={sorted} selected={selectedPath} onOpen={setSelectedPath} />
        <footer className="cb-tree-footer">
          <ThemePicker value={theme} onChange={setTheme} />
        </footer>
      </aside>
      <main data-testid="editor-panel">
        {selectedPath ? (
          <Editor relPath={selectedPath} />
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
