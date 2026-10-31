import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectAccess, ProjectInfo, TreeNode } from '../../shared/types'
import ChatPlaceholder from './chat/ChatPlaceholder'
import { Editor } from './editor/Editor'
import { flushAll } from './editor/saveRegistry'
import { isProse, nextAccess } from '../../shared/access'
import { FileTree } from './tree/FileTree'
import { ProseDialog } from './tree/ProseDialog'
import { sortTree } from './tree/sortTree'
import { ThemePicker } from './theme/ThemePicker'
import { useTheme } from './theme/useTheme'

const UNREADABLE =
  "Couldn't read .canonball/project.json. The AI can't see or change any files until it's fixed."

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
  const [accessState, setAccessState] = useState<{ root: string; access: ProjectAccess } | null>(
    null
  )
  const [proseOpen, setProseOpen] = useState(false)
  const [proseBusy, setProseBusy] = useState(false)
  const switching = useRef(false)
  const saving = useRef(false)

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
          setAccessState(null)
          setProseOpen(false)
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
      window.canonball
        .getProjectAccess()
        .then((access) => {
          if (!saving.current) setAccessState({ root, access })
        })
        .catch(() => {
          // keep the last known access
        })
    }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [root])

  const tree = refreshed && refreshed.root === project?.root ? refreshed.tree : project?.tree
  const access = accessState && accessState.root === root ? accessState.access : project?.access
  const sorted = useMemo(() => sortTree(tree ?? []), [tree])

  const cycle = (relPath: string): void => {
    if (!project || !access || saving.current) return
    saving.current = true
    const at = project.root
    window.canonball
      .setPathAccess(at, relPath, nextAccess(access.settings, relPath))
      .then((next) => setAccessState({ root: at, access: next }))
      .catch((e) => setError(message(e)))
      .finally(() => {
        saving.current = false
      })
  }

  const saveProse = (prose: string[]): void => {
    if (!project || !access || saving.current) return
    if (
      !access.needsProsePrompt &&
      new Set(prose).size === new Set(access.settings.prose).size &&
      prose.every((p) => access.settings.prose.includes(p))
    ) {
      setProseOpen(false)
      return
    }
    saving.current = true
    setProseBusy(true)
    const at = project.root
    window.canonball
      .setProsePaths(at, prose)
      .then((next) => {
        setAccessState({ root: at, access: next })
        setProseOpen(false)
      })
      .catch((e) => setError(message(e)))
      .finally(() => {
        saving.current = false
        setProseBusy(false)
      })
  }

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

  const prompting = !!access && access.needsProsePrompt && !access.unreadable
  const dialog =
    access && !access.unreadable && (prompting || proseOpen) ? (
      <ProseDialog
        key={prompting ? 'first' : 'edit'}
        tree={sorted}
        initial={
          prompting
            ? sorted.some((n) => n.kind === 'folder' && n.name === 'drafts')
              ? ['drafts']
              : []
            : access.settings.prose
        }
        onDone={saveProse}
        onCancel={prompting ? undefined : () => setProseOpen(false)}
        busy={proseBusy}
      />
    ) : null

  return (
    <div className="app">
      <aside data-testid="tree-panel">
        {error && (
          <p role="alert" className="cb-app-error">
            {error}
          </p>
        )}
        {access?.unreadable && (
          <p role="alert" className="cb-app-error">
            {UNREADABLE}
          </p>
        )}
        <FileTree
          tree={sorted}
          selected={selectedPath}
          onOpen={setSelectedPath}
          settings={(access ?? project.access).settings}
          onCycle={cycle}
        />
        <footer className="cb-tree-footer">
          {!access?.unreadable && (
            <button type="button" onClick={() => setProseOpen(true)}>
              Prose folders…
            </button>
          )}
          <ThemePicker value={theme} onChange={setTheme} />
        </footer>
      </aside>
      <main data-testid="editor-panel">
        {selectedPath ? (
          <Editor
            root={project.root}
            relPath={selectedPath}
            isProse={isProse((access ?? project.access).settings, selectedPath)}
          />
        ) : (
          <p className="editor-empty">Choose a file from the project</p>
        )}
      </main>
      {dialog}
      <aside data-testid="chat-panel">
        <ChatPlaceholder />
      </aside>
    </div>
  )
}

export default App
