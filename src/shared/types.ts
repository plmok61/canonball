import type {
  AiStatus,
  ChatEvent,
  ChatSummary,
  ChatThread,
  ChatRequest,
  CloudProvider,
  ModelChoice,
  ModelList
} from './ai'
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
  protection: ProjectProtection
}

export interface DocFile {
  content: string
  mtimeMs: number
}

export type ThemeSetting = 'light' | 'dark' | 'system'

export interface AppSettings {
  lastProjectRoot: string | null
  theme: ThemeSetting
  ai: { localUrl: string | null; model: ModelChoice | null }
}

export type TreeMenuKind = 'protect' | 'unprotect'

export type MenuCommand = 'open-project' | 'new-project' | 'open-settings'

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

export interface ProtectionSettings {
  version: 2
  protected: string[]
}

export interface ProjectProtection {
  /** Nothing protected when missing or unreadable. */
  settings: ProtectionSettings
  /** True only when the settings file does not exist. */
  needsProtectPrompt: boolean
  /** True when the file exists but failed to parse or validate. */
  unreadable: boolean
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
  getProjectProtection(): Promise<ProjectProtection>
  /** Rejects with 'Project changed' if `root` is no longer the open project. */
  setProtectedPaths(root: string, paths: string[]): Promise<ProjectProtection>
  changeProtection(root: string, kind: TreeMenuKind, relPath: string): Promise<ProjectProtection>
  showTreeMenu(kind: TreeMenuKind): Promise<boolean>
  /** One array of lints per input text, in the same order. */
  lintGrammar(texts: string[]): Promise<GrammarLint[][]>
  onFlushRequest(handler: () => Promise<void>): void
  /** Subscribe to application menu commands; returns an unsubscribe. */
  onMenuCommand(handler: (command: MenuCommand) => void): () => void
  /** Key presence only (booleans); key text never reaches the renderer. */
  getAiStatus(): Promise<AiStatus>
  /** `null` removes the key. */
  setApiKey(provider: CloudProvider, key: string | null): Promise<AiStatus>
  /** `null` clears the local server URL. */
  setLocalUrl(url: string | null): Promise<AiStatus>
  setModel(choice: ModelChoice | null): Promise<AiStatus>
  /** Models from configured providers; one failing doesn't hide the others. */
  listModels(): Promise<ModelList>
  /** Starts a stream; events arrive on onChatEvent. */
  startChat(req: ChatRequest): Promise<void>
  cancelChat(requestId: string): Promise<void>
  /** Rejects with 'Project changed', the expired copy, the changed copy, or a protection message. */
  applyProposal(root: string, id: string): Promise<{ relPath: string }>
  rejectProposal(id: string): Promise<void>
  /** Saved chat threads of the open project, newest first. */
  listChats(): Promise<ChatSummary[]>
  loadChat(id: string): Promise<ChatThread>
  saveChat(root: string, thread: ChatThread): Promise<void>
  /** Subscribe to chat stream events; returns an unsubscribe. */
  onChatEvent(handler: (e: ChatEvent) => void): () => void
}

export type EntryKind = 'file' | 'folder'

/** A rename or move of one project-relative path. */
export interface Move {
  from: string
  to: string
}

/** Entries added to and removed from the protected list by a file action. */
export interface ProtectionDelta {
  added: string[]
  removed: string[]
}
