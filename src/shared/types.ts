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

export interface CanonballApi {
  openProjectDialog(): Promise<ProjectInfo | null>
  newProjectDialog(): Promise<ProjectInfo | null>
  openProject(root: string): Promise<ProjectInfo>
  refreshTree(): Promise<TreeNode[]>
  readDoc(relPath: string): Promise<DocFile>
  writeDoc(relPath: string, content: string): Promise<DocFile>
  getSettings(): Promise<AppSettings>
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  onFlushRequest(handler: () => Promise<void>): void
}
