import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectInfo, ProjectProtection, TreeNode } from '../../shared/types'
import { ChatPanel } from './chat/ChatPanel'
import { Editor } from './editor/Editor'
import { flushAll } from './editor/saveRegistry'
import { isProtected } from '../../shared/protection'
import { SettingsDialog } from './settings/SettingsDialog'
import { FileTree } from './tree/FileTree'
import { ProseDialog } from './tree/ProseDialog'
import { sortTree } from './tree/sortTree'
import { ThemePicker } from './theme/ThemePicker'
import { useTheme } from './theme/useTheme'

const UNREADABLE =
  "Couldn't read .canonball/project.json. The AI can't change any files until it's fixed."

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
  const [protectionState, setProtectionState] = useState<{
    root: string
    protection: ProjectProtection
  } | null>(null)
  const [proseOpen, setProseOpen] = useState(false)
  const [proseBusy, setProseBusy] = useState(false)
  const [proseError, setProseError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Bumped whenever an AI connection changes; the chat panel reloads on it.
  const [aiVersion, setAiVersion] = useState(0)
  // Bumped when an accepted AI change rewrote the open file; the editor reloads on it.
  const [reloadToken, setReloadToken] = useState(0)
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
          setProtectionState(null)
          setProseOpen(false)
          setProseError(null)
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
        switch (command) {
          case 'open-settings':
            setSettingsOpen(true)
            break
          case 'open-project':
            void switchProject(() => window.canonball.openProjectDialog())
            break
          case 'new-project':
            void switchProject(() => window.canonball.newProjectDialog())
            break
        }
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
        .getProjectProtection()
        .then((protection) => {
          if (!saving.current) setProtectionState({ root, protection })
        })
        .catch(() => {
          // keep the last known protection
        })
    }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [root])

  const tree = refreshed && refreshed.root === project?.root ? refreshed.tree : project?.tree
  const protection =
    protectionState && protectionState.root === root
      ? protectionState.protection
      : project?.protection
  const sorted = useMemo(() => sortTree(tree ?? []), [tree])

  /** An accepted AI suggestion wrote `relPath`. */
  const onFileChanged = (relPath: string): void => {
    if (!project) return
    const at = project.root
    window.canonball
      .refreshTree()
      .then((t) => setRefreshed({ root: at, tree: t }))
      .catch(() => {
        // keep the last known tree
      })
    if (relPath === selectedPath) setReloadToken((n) => n + 1)
  }

  const openProse = (): void => {
    setProseError(null)
    setProseOpen(true)
  }

  const closeProse = (): void => {
    setProseError(null)
    setProseOpen(false)
  }

  const saveProse = (prose: string[]): void => {
    if (!project || !protection || saving.current) return
    if (
      !protection.needsProtectPrompt &&
      new Set(prose).size === new Set(protection.settings.protected).size &&
      prose.every((p) => protection.settings.protected.includes(p))
    ) {
      setProseOpen(false)
      return
    }
    saving.current = true
    setError(null)
    setProseError(null)
    setProseBusy(true)
    const at = project.root
    window.canonball
      .setProtectedPaths(at, prose)
      .then((next) => {
        setProtectionState({ root: at, protection: next })
        setProseOpen(false)
      })
      .catch((e) => setProseError(message(e)))
      .finally(() => {
        saving.current = false
        setProseBusy(false)
      })
  }

  const settingsDialog = settingsOpen ? (
    <SettingsDialog
      onClose={() => setSettingsOpen(false)}
      onChanged={() => setAiVersion((v) => v + 1)}
    />
  ) : null

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
        <button onClick={() => setSettingsOpen(true)}>Settings…</button>
        {error && <p role="alert">{error}</p>}
        {settingsDialog}
      </div>
    )
  }

  const prompting = !!protection && protection.needsProtectPrompt && !protection.unreadable
  const dialog =
    protection && !protection.unreadable && (prompting || proseOpen) ? (
      <ProseDialog
        key={prompting ? 'first' : 'edit'}
        tree={sorted}
        initial={
          prompting
            ? sorted.some((n) => n.kind === 'folder' && n.name === 'drafts')
              ? ['drafts']
              : []
            : protection.settings.protected
        }
        onDone={saveProse}
        onCancel={prompting ? undefined : closeProse}
        busy={proseBusy}
        error={proseError}
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
        {protection?.unreadable && (
          <p role="alert" className="cb-app-error">
            {UNREADABLE}
          </p>
        )}
        <FileTree
          tree={sorted}
          selected={selectedPath}
          onOpen={setSelectedPath}
          settings={(protection ?? project.protection).settings}
        />
        <footer className="cb-tree-footer">
          {!protection?.unreadable && (
            <button type="button" onClick={openProse}>
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
            isProtected={isProtected((protection ?? project.protection).settings, selectedPath)}
            reloadToken={reloadToken}
          />
        ) : (
          <p className="editor-empty">Choose a file from the project</p>
        )}
      </main>
      {dialog}
      {settingsDialog}
      <aside data-testid="chat-panel">
        <ChatPanel
          key={project.root}
          root={project.root}
          aiVersion={aiVersion}
          onOpenSettings={() => setSettingsOpen(true)}
          onFileChanged={onFileChanged}
        />
      </aside>
    </div>
  )
}

export default App
