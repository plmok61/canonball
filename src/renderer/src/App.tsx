import { useEffect, useState } from 'react'
import type { ProjectInfo } from '../../shared/types'
import ChatPlaceholder from './chat/ChatPlaceholder'

function App(): React.JSX.Element {
  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [ready, setReady] = useState(false)

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

  if (!ready) return <div className="app" />

  if (!project) {
    const pick = async (fn: () => Promise<ProjectInfo | null>): Promise<void> => {
      const info = await fn()
      if (info) setProject(info)
    }
    return (
      <div className="welcome" data-testid="welcome">
        <h1>Canonball</h1>
        <button onClick={() => pick(() => window.canonball.openProjectDialog())}>
          Open Project…
        </button>
        <button onClick={() => pick(() => window.canonball.newProjectDialog())}>
          New Project…
        </button>
      </div>
    )
  }

  return (
    <div className="app">
      <aside data-testid="tree-panel" />
      <main data-testid="editor-panel" />
      <aside data-testid="chat-panel">
        <ChatPlaceholder />
      </aside>
    </div>
  )
}

export default App
