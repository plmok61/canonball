export interface TreeNode {
  name: string
  relPath: string
  kind: 'folder' | 'file'
  children?: TreeNode[]
}

export interface ProjectInfo {
  root: string
  name: string
  tree: TreeNode[]
}

export interface DocFile {
  content: string
  mtimeMs: number
}

export type ThemeSetting = 'light' | 'dark' | 'system'

export interface AppSettings {
  lastProjectRoot: string | null
  theme: ThemeSetting
}

export type MenuCommand = 'open-project' | 'new-project'

/** The renderer's reply to a flush request before the window closes. */
export interface FlushResult {
  ok: boolean
  error?: string
}

export interface GrammarSuggestion {
  label: string
  replacement: string
}

export interface GrammarLint {
  /** UTF-16 offset into the text that was linted. */
  start: number
  end: number
  /** The flagged text, text.slice(start, end). */
  problem: string
  message: string
  /** Harper's lint_kind_pretty(). */
  kind: string
  /** Each replacement covers [start, end). */
  suggestions: GrammarSuggestion[]
}

export interface CanonballApi {
  openProjectDialog(): Promise<ProjectInfo | null>
  newProjectDialog(): Promise<ProjectInfo | null>
  openProject(root: string): Promise<ProjectInfo>
  refreshTree(): Promise<TreeNode[]>
  readDoc(relPath: string): Promise<DocFile>
  /** Rejects with 'Project changed' if `root` is no longer the open project. */
  writeDoc(root: string, relPath: string, content: string): Promise<DocFile>
  getSettings(): Promise<AppSettings>
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  /** One array of lints per input text, in the same order. */
  lintGrammar(texts: string[]): Promise<GrammarLint[][]>
  onFlushRequest(handler: () => Promise<void>): void
  /** Subscribe to application menu commands; returns an unsubscribe. */
  onMenuCommand(handler: (command: MenuCommand) => void): () => void
}
