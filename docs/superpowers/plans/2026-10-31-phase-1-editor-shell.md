# Phase 1: Editor Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Mac desktop app that opens or creates a Canonball project, shows its folder tree, and lets the writer write in a WYSIWYG editor that saves plain markdown, in light, dark or system theme. There's no AI yet, and the chat panel is a placeholder.

**Architecture:** An electron-vite app. The main process owns the filesystem, keeps track of the current project root, and stores app settings. The renderer is React with TipTap and reaches the disk only through a typed `window.canonball` API exposed by the preload script. Markdown conversion lives in one renderer module, so the "never damage the writer's file" guarantees are tested in one place.

**Tech Stack:** Electron, electron-vite (react-ts template), React, TypeScript, TipTap v3 (open-source packages only) with `@tiptap/markdown`, `yaml`, Vitest, @testing-library/react, jsdom.

**Spec:** `docs/superpowers/specs/2026-10-31-canonball-app-design.md` · **Roadmap:** `docs/superpowers/plans/2026-10-31-roadmap.md`

## Global Constraints

- Mac first; Windows and Linux are not targets in this phase.
- Use only free, open-source TipTap packages: no TipTap Cloud, Pro, or paid extensions.
- Writers never see raw markdown syntax, and the prose font is a serif.
- Files on disk stay plain markdown. The app **never writes a file the writer didn't change**.
- Dark palette: warm off-white text on soft near-black, with no pure white (`#fff`) or pure black (`#000`) anywhere in the dark theme.
- Theme choices are exactly: Light, Dark, Match System (default: Match System).
- Draft banner copy: `Draft — AI won't edit`.
- File names are shown in the tree without the `.md` extension.
- `contextIsolation: true`, `nodeIntegration: false`. The renderer touches the disk only via `window.canonball`.
- Every project-relative path from the renderer is resolved inside the project root, and anything that escapes it is rejected.

## Review Focus

1. **Opening a file and closing it without typing** must leave the file byte-identical on disk, with no reformatting churn in git. → Task 5 test `does not write when a file is opened and closed without edits`.
2. **Front matter, HTML comments, and markdown the editor doesn't model** must survive a save. → Task 4 fixture tests.
3. **Typing, then immediately switching files or quitting** must not lose the last keystrokes (the debounce window). → Task 5 tests `flushes pending save on file switch` and the close-flush handshake in Task 3.
4. **A draft that begins with a scene break (`---`)** must not be mistaken for front matter and hidden. → Task 4 test `does not treat a leading scene break as front matter`.
5. **A file changed on disk by another program** (git checkout, another editor) while it's open must not be silently overwritten by a stale buffer. → Task 5 test `reloads from disk on focus when clean and mtime changed`.

---

## File Structure

```
package.json, electron.vite.config.ts, tsconfig*.json, vitest.config.ts   (from electron-vite template + vitest)
template/                    new-project scaffold (moved from repo root in Task 2)
docs/reference/              AI-isms-guide.md, ai-isms.json (moved in Task 2)
src/shared/types.ts          TreeNode, ProjectInfo, AppSettings, ThemeSetting, CanonballApi
src/shared/paths.ts          displayName, isProsePath
src/main/index.ts            window creation, close-flush handshake
src/main/projectFs.ts        resolveInside, listTree, readDoc, writeDoc, createProject
src/main/appSettings.ts      load/save AppSettings in userData
src/main/ipc.ts              registers IPC handlers; holds current project root
src/preload/index.ts         exposes window.canonball: CanonballApi
src/renderer/src/App.tsx     three-panel layout, project lifecycle
src/renderer/src/theme/      theme.css (tokens), resolveTheme.ts, useTheme.ts
src/renderer/src/tree/       FileTree.tsx, sortTree.ts
src/renderer/src/editor/     extensions.ts, markdown.ts, autosave.ts, wordCount.ts, Editor.tsx, Toolbar.tsx
src/renderer/src/chat/ChatPlaceholder.tsx
```

Tests sit next to the code as `*.test.ts(x)`. Renderer tests start with `// @vitest-environment jsdom`.

---

### Task 1: App skeleton

**Files:**
- Create: everything from the electron-vite `react-ts` template at repo root; `vitest.config.ts`; `src/renderer/src/App.tsx`; `src/renderer/src/chat/ChatPlaceholder.tsx`; `src/renderer/src/App.test.tsx`
- Modify: `.gitignore` (add `node_modules/`, `out/`, `dist/`)

**Interfaces:**
- Produces: `App` with three regions `data-testid="tree-panel"`, `"editor-panel"`, `"chat-panel"`; `npm run dev`, `npm run build`, `npm test` scripts.

- [ ] **Step 1: Scaffold.** Run `npm create @quick-start/electron@latest canonball-app -- --template react-ts` in the scratchpad directory, then copy its files (not `.git`) into the repo root. Set `"name": "canonball"`, `"productName": "Canonball"`. Add devDeps `vitest @testing-library/react @testing-library/jest-dom jsdom`, and `"test": "vitest run"`.
- [ ] **Step 2: Write the failing test** `App.test.tsx` › `renders tree, editor and chat panels`, which renders `<App />` with `window.canonball` stubbed and asserts that all three test ids are in the document and that the chat panel contains the text `AI chat arrives in a later phase`.
- [ ] **Step 3: Run** `npm test`. Expected: FAIL (no test ids).
- [ ] **Step 4: Implement** a CSS-grid layout in `App.tsx`: tree `220px`, editor `1fr`, chat `290px`, full window height. `ChatPlaceholder` renders the copy above.
- [ ] **Step 5: Run** `npm test` → PASS; `npm run build` → succeeds; `npm run dev` opens a window with three panels.
- [ ] **Step 6: Commit** `feat: electron app skeleton with three-panel layout`.

---

### Task 2: Project filesystem and template

**Files:**
- Move: `canon/ notes/ outline/ drafts/ sessions/` → `template/`; `memory/{style_rules,names_to_avoid,user_profile,feedback_tone}.md` → `template/memory/`; `AI-isms-guide.md`, `memory/ai-isms.json` → `docs/reference/`. Delete `memory/MEMORY.md` (it's a Claude-only index). Update the `style_rules.md` "Why" line to point to `docs/reference/`. `CLAUDE.md` stays at the root and is not copied into the template.
- Create: `src/shared/types.ts`, `src/shared/paths.ts`, `src/main/projectFs.ts`, `src/main/projectFs.test.ts`, `src/shared/paths.test.ts`
- Modify: `CLAUDE.md`: replace the scaffold guidance with a short app-development guide (stack, `npm run dev`/`npm test`, where the spec/roadmap/OPEN_WORK live, and the rule that the AI never edits prose folders). Keep the Writing Style pointer, now aimed at `template/memory/style_rules.md`.

**Interfaces:**
- Produces (`src/shared/types.ts`):
  ```ts
  export interface TreeNode { name: string; relPath: string; kind: 'folder' | 'file'; children?: TreeNode[] }
  export interface ProjectInfo { root: string; name: string; tree: TreeNode[] }
  export interface DocFile { content: string; mtimeMs: number }
  ```
- Produces (`src/main/projectFs.ts`):
  - `resolveInside(root: string, relPath: string): string`, which throws `Error('Path escapes project')` for absolute paths, `..` escapes, or symlinks that resolve outside `root`
  - `listTree(root: string): Promise<TreeNode[]>`, which includes folders and `.md` files only and skips names starting with `.` and `node_modules`. `relPath` uses `/`. Order is unsorted (sorting is the renderer's job, Task 6).
  - `readDoc(root: string, relPath: string): Promise<DocFile>`
  - `writeDoc(root: string, relPath: string, content: string): Promise<DocFile>`, which writes atomically (temp file in the same folder, then rename) and returns the new mtime
  - `createProject(targetDir: string, templateDir: string): Promise<void>`, which throws `Error('Folder is not empty')` if `targetDir` exists with entries. It copies `templateDir` and writes `.gitignore` containing `.canonball/chats/`.
- Produces (`src/shared/paths.ts`): `displayName(fileName: string): string` (strips a trailing `.md`); `isProsePath(relPath: string): boolean` (true when `relPath` starts with `drafts/`; Phase 3 replaces this with prose-folder settings).

- [ ] **Step 1: Do the moves** above with `git mv`. Commit `chore: move scaffold into template/` on its own so the history stays readable.
- [ ] **Step 2: Write failing tests** in `projectFs.test.ts` using a temp dir per test:
  - `resolveInside rejects ../ escapes, absolute paths and outside symlinks`
  - `listTree returns folders and .md files, skipping dotfiles, node_modules and non-md files`
  - `writeDoc then readDoc round-trips content and returns a newer mtime`
  - `createProject copies template and writes .gitignore with .canonball/chats/`, run against the real `template/` dir, asserting that `canon/characters.md` and `memory/style_rules.md` exist and that `CLAUDE.md` does not
  - `createProject refuses a non-empty folder`

  And in `paths.test.ts`: `displayName('draft2.md') === 'draft2'`, `displayName('notes') === 'notes'`, `isProsePath('drafts/chapters/1/draft1.md') === true`, `isProsePath('canon/world.md') === false`.
- [ ] **Step 3: Run** `npm test`. Expected: FAIL (modules missing).
- [ ] **Step 4: Implement** `types.ts`, `paths.ts`, `projectFs.ts` (use `fs/promises`, and `fs.cp` with `recursive: true` for the template).
- [ ] **Step 5: Run** `npm test` → PASS.
- [ ] **Step 6: Update `CLAUDE.md`** as described. Commit `feat: project filesystem layer and new-project template`.

---

### Task 3: IPC, app settings, open/new project

**Files:**
- Create: `src/main/appSettings.ts`, `src/main/appSettings.test.ts`, `src/main/ipc.ts`
- Modify: `src/main/index.ts`, `src/preload/index.ts`, `src/shared/types.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/env.d.ts` (declare `window.canonball`)
- Package: `template/` is bundled as an extra resource; in dev it's resolved from the repo root.

**Interfaces:**
- Consumes: Task 2's `projectFs` functions and types.
- Produces (`src/shared/types.ts`):
  ```ts
  export type ThemeSetting = 'light' | 'dark' | 'system'
  export interface AppSettings { lastProjectRoot: string | null; theme: ThemeSetting }
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
  ```
- Produces (`src/main/appSettings.ts`): `loadSettings(file: string): Promise<AppSettings>` (missing or corrupt file → `{ lastProjectRoot: null, theme: 'system' }`); `saveSettings(file: string, s: AppSettings): Promise<void>`. The file is `app.getPath('userData')/settings.json`.
- Behavior: `newProjectDialog` uses `dialog.showSaveDialog` (the writer picks a location and a folder name), then `createProject`, then opens it. `openProject` and both dialogs set `lastProjectRoot`. On launch, the renderer reopens `lastProjectRoot` if it still exists, and otherwise shows a welcome screen with **Open Project…** and **New Project…** buttons.
- Close-flush handshake: on the window's `close`, main calls `preventDefault()`, sends `canonball:flush-request`, waits for `canonball:flush-done` (up to 3 s), then closes. The preload's `onFlushRequest` runs the handler and replies.

- [ ] **Step 1: Write failing tests** in `appSettings.test.ts`: `returns defaults when file is missing`, `returns defaults when file is corrupt JSON`, `save then load round-trips`.
- [ ] **Step 2: Run** `npm test` → FAIL.
- [ ] **Step 3: Implement** `appSettings.ts`, then `ipc.ts` (one `ipcMain.handle` per API method; the current root lives in this module), the preload bridge, and the welcome screen and reopen-last-project logic in `App.tsx`.
- [ ] **Step 4: Add an `App.test.tsx` case** `shows welcome screen when no last project`, with `getSettings` stubbed to return `lastProjectRoot: null`. Assert that both buttons render.
- [ ] **Step 5: Run** `npm test` → PASS. Manual check in `npm run dev`: create a new project in the scratchpad, quit, relaunch, and confirm it reopens.
- [ ] **Step 6: Commit** `feat: open and create projects over IPC`.

---

### Task 4: Markdown round-trip

**Files:**
- Create: `src/renderer/src/editor/extensions.ts`, `src/renderer/src/editor/markdown.ts`, `src/renderer/src/editor/markdown.test.ts`

**Interfaces:**
- Produces (`extensions.ts`): `createExtensions(): Extensions`, containing StarterKit (headings 1–3, bold, italic, blockquote, bullet and ordered lists, horizontal rule as the scene break), `Markdown` from `@tiptap/markdown`, the table extensions, Link, and a custom `HtmlComment` atom node (attrs `{ raw: string }`, rendered as `<div class="cb-hint" contenteditable="false">` showing the comment's inner text, serialized back as `raw` exactly). Inline comments inside a paragraph must also survive; an inline atom variant is fine.
- Produces (`markdown.ts`):
  ```ts
  export interface OpenDoc { frontMatter: string | null }   // raw text incl. both --- fences and trailing newline
  export function splitFrontMatter(md: string): { frontMatter: string | null; body: string }
  export function loadIntoEditor(editor: Editor, md: string): OpenDoc   // setContent with emitUpdate: false
  export function serializeEditor(editor: Editor, doc: OpenDoc): string  // frontMatter + markdown body, single trailing newline
  ```
- Front-matter rule: the first line is exactly `---`, a later line is exactly `---`, and the text between them parses with `yaml` to a plain object. Anything else → `frontMatter: null`.

- [ ] **Step 1: Write failing tests** in `markdown.test.ts`, each using a headless `new Editor({ extensions: createExtensions() })`:
  - `preserves front matter byte-for-byte`, using `template/memory/style_rules.md`
  - `does not treat a leading scene break as front matter`: `'---\n\nShe left.\n\n---\n\nHe stayed.\n'` → `frontMatter === null` and the output contains both `She left.` and `He stayed.`
  - `preserves block HTML comments verbatim`, run on every `.md` under `template/`: every `<!-- … -->` in the input appears unchanged in the output
  - `preserves inline HTML comments`: `'Eyes are <!-- decide --> grey.\n'` round-trips containing `<!-- decide -->`
  - `round trip is idempotent`: for each template file, `serialize(load(serialize(load(x)))) === serialize(load(x))`
  - `keeps every word`: for each template file, the multiset of words in the input (outside markdown punctuation) equals the multiset in the output
  - `scene break serializes as a thematic break`: a doc with paragraph, horizontal rule, paragraph serializes with a line matching `/^(---|\*\*\*|\* \* \*)$/m`
  - `tables and links round-trip`: `'| A | B |\n|---|---|\n| 1 | 2 |\n\n[site](https://example.com)\n'` → output re-parses to the same table cell texts and link href
- [ ] **Step 2: Run** `npm test -- markdown` → FAIL.
- [ ] **Step 3: Implement.** For `HtmlComment`, use `@tiptap/markdown`'s node hooks (`markdownTokenizer`/`parseMarkdown`/`renderMarkdown`). If `@tiptap/markdown` can't preserve comments or tables, swap in `tiptap-markdown` behind the same two functions and note the swap in the commit message.
- [ ] **Step 4: Run** `npm test -- markdown` → PASS.
- [ ] **Step 5: Commit** `feat: lossless markdown load/save for the editor`.

---

### Task 5: Editor, toolbar, autosave

**Files:**
- Create: `src/renderer/src/editor/autosave.ts`, `autosave.test.ts`, `wordCount.ts`, `wordCount.test.ts`, `Editor.tsx`, `Editor.test.tsx`, `Toolbar.tsx`, `editor.css`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `loadIntoEditor`, `serializeEditor`, `createExtensions` (Task 4); `window.canonball.readDoc/writeDoc/onFlushRequest` (Task 3); `isProsePath`, `displayName` (Task 2).
- Produces:
  ```ts
  // autosave.ts
  export class Autosave {
    constructor(opts: { delayMs: number; save: (content: string) => Promise<void>; initial: string })
    change(content: string): void      // schedule save; no-op if content equals last saved
    flush(): Promise<void>             // save pending content now
    readonly dirty: boolean
  }
  // wordCount.ts
  export function countWords(text: string): number   // whitespace-separated tokens containing a letter or digit
  // Editor.tsx
  export function Editor(props: { relPath: string }): JSX.Element
  ```
- Values: debounce `800` ms. The status bar shows `relPath`, `N words`, and `saved` or `saving…`. Word count uses the editor's text excluding `.cb-hint` nodes.
- Toolbar, in this order: Bold, Italic, Heading (Normal / Heading 1 / Heading 2 / Heading 3), Quote, Bullet list, Numbered list, Scene break.
- Draft banner `Draft — AI won't edit` is shown in the toolbar row when `isProsePath(relPath)`.
- On window `focus`: if not dirty and `readDoc` returns a different `mtimeMs`, reload the content.
- `App` registers `onFlushRequest(() => autosave.flush())` for the open file, and flushes before switching files.

- [ ] **Step 1: Write failing tests**
  - `autosave.test.ts` (fake timers): `saves once after 800ms of quiet`, `does not save when content equals last saved`, `flush saves pending content immediately`, `dirty is false after save resolves`
  - `wordCount.test.ts`: `countWords('She left. He — stayed.') === 4`, `countWords('  ') === 0`
  - `Editor.test.tsx` (stubbed `window.canonball`): `does not write when a file is opened and closed without edits` (render, unmount, `writeDoc` never called); `flushes pending save on file switch` (type, rerender with a new `relPath` before 800 ms, `writeDoc` called once with the old path); `shows draft banner only for prose paths`; `reloads from disk on focus when clean and mtime changed`
- [ ] **Step 2: Run** `npm test` → FAIL.
- [ ] **Step 3: Implement** `autosave.ts`, `wordCount.ts`, then `Editor.tsx`/`Toolbar.tsx` with `@tiptap/react`. Use page styling in `editor.css`: serif stack `'Iowan Old Style', Georgia, serif`, `16px/1.75`, max text width `68ch`, centered; `.cb-hint` is faint and italic.
- [ ] **Step 4: Run** `npm test` → PASS. Manual check: open `canon/characters.md` in a new project, confirm hints show and headings render without `#`, type, quit within a second, relaunch, and confirm the text is there.
- [ ] **Step 5: Commit** `feat: WYSIWYG editor with autosave`.

---

### Task 6: File tree

**Files:**
- Create: `src/renderer/src/tree/sortTree.ts`, `sortTree.test.ts`, `FileTree.tsx`, `FileTree.test.tsx`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `TreeNode`, `displayName`; `window.canonball.refreshTree`.
- Produces: `sortTree(nodes: TreeNode[]): TreeNode[]` (recursive: folders before files, then `localeCompare` with `{ numeric: true, sensitivity: 'base' }`); `FileTree(props: { tree: TreeNode[]; selected: string | null; onOpen(relPath: string): void })`.
- Behavior: top-level folders start expanded. Clicking a folder toggles it, and clicking a file calls `onOpen`. The selected file is highlighted. `App` calls `refreshTree` on window focus. There's a space reserved on the right of each row for Phase 3's permission badge (an empty `<span class="cb-badge-slot">`).

- [ ] **Step 1: Write failing tests**: `sortTree` › `puts chapter 10 after chapter 2`, `puts folders before files`; `FileTree` › `shows names without .md`, `clicking a file calls onOpen with relPath`, `clicking a folder collapses it`.
- [ ] **Step 2: Run** `npm test` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** `feat: project file tree`.

---

### Task 7: Themes

**Files:**
- Create: `src/renderer/src/theme/theme.css`, `resolveTheme.ts`, `resolveTheme.test.ts`, `useTheme.ts`, `ThemePicker.tsx`
- Modify: `src/renderer/src/App.tsx`, every component stylesheet (colors only via tokens)

**Interfaces:**
- Consumes: `getSettings`/`setSettings` (Task 3).
- Produces: `resolveTheme(setting: ThemeSetting, systemDark: boolean): 'light' | 'dark'`; `useTheme()` sets `document.documentElement.dataset.theme` and follows `matchMedia('(prefers-color-scheme: dark)')` changes when the setting is `system`. Main also sets `nativeTheme.themeSource` to match.
- Tokens (from the approved mockups):

  | Token | Light | Dark |
  |---|---|---|
  | `--bg` | `#fdfcfa` | `#1c1b19` |
  | `--bg-sidebar` | `#f7f6f3` | `#161513` |
  | `--bg-chat` | `#fbfbfa` | `#191816` |
  | `--border` | `#e3e3e3` | `#2e2c29` |
  | `--text` | `#1e1e1e` | `#ddd7cc` |
  | `--text-strong` | `#111111` | `#ece7dd` |
  | `--text-muted` | `#888888` | `#7a756c` |
  | `--selection` | `#e6e1d6` | `#2c2a26` |
  | `--accent-warn` / `--accent-warn-bg` | `#a06a00` / `#fbf3e2` | `#d9a74a` / `#33291a` |

- The picker is a small segmented control (Light / Dark / Match System) in the tree panel's footer.

- [ ] **Step 1: Write failing tests**: `resolveTheme` › `system follows systemDark`, `explicit setting ignores system`; plus a test that reads `theme.css` and asserts the `[data-theme="dark"]` block contains neither `#fff`/`#ffffff` nor `#000`/`#000000`.
- [ ] **Step 2: Run** `npm test` → FAIL.
- [ ] **Step 3: Implement**, and replace any hard-coded colors from Tasks 1–6 with tokens (`grep -rn '#[0-9a-fA-F]\{3,6\}' src/renderer --include=*.css --include=*.tsx` shows only `theme.css` afterward).
- [ ] **Step 4: Run** `npm test` → PASS. Manual check: switch all three settings; the macOS appearance change is followed under Match System.
- [ ] **Step 5: Commit** `feat: light, dark and system themes`.

---

### Task 8: Phase wrap-up

**Files:**
- Modify: `OPEN_WORK.md`, `COMPLETED_WORK.md`

- [ ] **Step 1: Run** `npm test` and `npm run build`. Both must pass.
- [ ] **Step 2: Move** "Phase 1: Editor shell" from `OPEN_WORK.md` to `COMPLETED_WORK.md` under today's date. Note anything learned that changes later phases (e.g. which markdown package was used) in `OPEN_WORK.md` under Phase 2.
- [ ] **Step 3: Commit** `docs: complete phase 1`.
