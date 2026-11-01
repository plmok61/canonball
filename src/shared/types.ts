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
import type { TreeMenuItem } from './treeMenuItems'
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

export type MenuCommand = 'open-project' | 'new-project' | 'open-settings' | 'undo' | 'redo'

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
  /** Pops the native tree menu; resolves the clicked item, or null if dismissed. */
  showTreeMenu(items: (TreeMenuItem | '-')[]): Promise<TreeMenuItem | null>
  /** Native confirm dialog; resolves true when the `ok` button is chosen. */
  confirmDialog(opts: { message: string; detail?: string; ok: string }): Promise<boolean>
  nativeUndo(): void
  nativeRedo(): void
  /** File actions. Each rejects with 'Project changed' if `root` is no longer the open project. */
  createEntry(
    root: string,
    kind: EntryKind,
    parentRel: string,
    name: string
  ): Promise<FileOpResult & { relPath: string }>
  renameEntry(
    root: string,
    relPath: string,
    newName: string
  ): Promise<FileOpResult & { move: Move }>
  pasteEntries(
    root: string,
    mode: 'copy' | 'move',
    relPaths: string[],
    destRel: string
  ): Promise<FileOpResult & { created: string[]; moves: Move[] }>
  duplicateEntries(root: string, relPaths: string[]): Promise<FileOpResult & { created: string[] }>
  moveExact(root: string, moves: Move[]): Promise<FileOpResult>
  trashEntries(root: string, relPaths: string[]): Promise<FileOpResult & { trashed: TrashedItem[] }>
  restoreEntries(root: string, items: TrashedItem[]): Promise<FileOpResult>
  removeCreated(
    root: string,
    relPaths: string[]
  ): Promise<FileOpResult & { trashed: TrashedItem[] }>
  changeProtectionMany(
    root: string,
    kind: TreeMenuKind,
    relPaths: string[]
  ): Promise<{ protection: ProjectProtection; delta: ProtectionDelta }>
  applyProtectionDelta(
    root: string,
    delta: ProtectionDelta
  ): Promise<{ protection: ProjectProtection; applied: ProtectionDelta }>
  revealEntry(root: string, relPath: string): Promise<void>
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

/** An item moved into the holding area, `.canonball/trash/<id>/<name>`. */
export interface TrashedItem {
  id: string
  /** Where it was, project-relative. */
  from: string
  /** The protected entries at or under `from` when it was trashed. */
  protectedEntries: string[]
}

/** What every file action returns: the fresh tree and protection. */
export interface FileOpResult {
  tree: TreeNode[]
  protection: ProjectProtection
}
