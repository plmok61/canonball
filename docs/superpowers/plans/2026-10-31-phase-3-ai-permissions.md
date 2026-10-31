# Phase 3: AI Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The writer sees and sets, per folder and per file, what the AI may do (✎ / 👁 / ⊘), marks which folders hold prose, and main has an access layer that refuses every AI write to prose, before any AI code exists.

**Architecture:** Permissions live in `.canonball/project.json`. The rules (inheritance, prose clamping, badge cycling, validation) are pure functions in `src/shared/access.ts`, used by both main and renderer. Main loads and saves the file (`src/main/projectSettings.ts`) and owns the AI access layer (`src/main/aiAccess.ts`), which canonicalizes every path against the real disk before checking it. Phase 5's AI tools will call only `aiAccess`. The renderer shows badges in the tree, a legend, and a prose-folders dialog that opens once for projects without settings.

**Tech Stack:** Electron 44, React 19, TypeScript, Vitest + Testing Library. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-31-canonball-app-design.md` (sections "AI permissions", "The screen › Left: project tree", "Projects"). Earlier interfaces: `docs/superpowers/plans/2026-10-31-phase-1-editor-shell.md` and `…-phase-2-writing-aids.md`. The code is the authority where they differ (e.g. `writeDoc(root, relPath, content)`, `Editor({ root, relPath })`, `requireCurrentRoot(current, claimed)` in `src/main/projectFs.ts`).

## Rulings (calls made without the author; see spec "Claude's call" sections)

- Ruling: the file format is `{ "version": 1, "prose": string[], "access": { [relPath]: "edit" | "read" | "hidden" } }`, pretty-printed with 2-space indent and a trailing newline. Keys are project-relative paths with `/`, no leading or trailing slash.
- Ruling: inheritance is **nearest explicit entry wins**: the path itself, then each ancestor folder up to the top. No entry anywhere → `read` (spec: unlisted folders and top-level files default to 👁).
- Ruling: a path is prose when it equals or sits under a `prose` entry. Prose entries may be folders or top-level files, because the spec allows prose "at the top level" and a root-wide prose mark would block every AI edit in the project.
- Ruling: prose clamps `edit` to `read` at evaluation time, and saving prose marks also deletes `edit` overrides at or under them, so the file never says ✎ for prose.
- Ruling: clicking a badge cycles ✎ → 👁 → ⊘ → ✎. For prose it cycles 👁 ↔ ⊘. If the new value equals what the path would inherit without its own entry, the entry is removed, so the path goes back to following its folder.
- Ruling: the AI never sees dot-paths (any segment starting with `.`, which covers `.canonball/`) or non-`.md` files, whatever the badges say.
- Ruling: AI may create a file only when the folder it goes in has effective ✎ and is not prose. The project's top level has no entry of its own, so it is 👁 and the AI can't create files there.
- Ruling: new projects get `.canonball/project.json` from `createProject` with the spec's default table and `prose: ["drafts"]`. Projects without the file get all-👁 in memory and the prose dialog. Nothing is written until the writer presses **Done**. Done with nothing ticked still writes the file (`prose: []`), so the app asks only once.
- Ruling: the dialog cannot be dismissed without Done. It pre-ticks `drafts` if that folder exists. It lists every folder (indented) and each top-level `.md` file. The tree footer has a **Prose folders…** button that reopens it, which is how the writer marks prose "from the tree".
- Ruling: an unreadable or invalid `project.json` (bad JSON, wrong shape) is never overwritten. The project opens with all-👁 rules, the AI can't write anything, badge and prose changes are refused with `Project settings file is unreadable`, and the tree shows `Couldn't read .canonball/project.json. AI access is read-only until it's fixed.`
- Ruling: main re-reads `project.json` from disk on every access-layer call and every renderer settings call (it's a small file), so external edits are never stale. The renderer re-fetches it with the tree on window focus.
- Ruling: the Draft banner now shows for any prose path, with the same copy, `Draft — AI won't edit`.
- Ruling: inherited badges are drawn in `--text-muted`, explicit ones in `--text`. Prose rows show a muted `prose` tag after the name.
- Ruling: renaming a folder outside the app leaves its old entries orphaned (they match nothing, so the folder falls back to inherited/👁). No migration this phase; noted in `OPEN_WORK.md`.

## Global Constraints

- **The AI never edits prose folders.** A prose path can be 👁 or ⊘, never ✎. The refusal is in main's access layer, not only in the UI or a prompt.
- Every AI write path is canonicalized against the disk before the check: `..` segments, letter case (macOS volumes are case-insensitive: `DRAFTS/x.md` is `drafts/x.md`) and symlinks inside the project (`canon/link → ../drafts`) must all resolve to the real target, and the check runs on that.
- The app never writes a file the writer didn't change. Opening a project, refreshing, or showing the dialog writes nothing. Only a badge click, Done, or `createProject` writes `project.json`.
- The renderer touches the disk only through `window.canonball`. Every IPC argument is validated in main, and every settings write goes through `requireCurrentRoot(currentRoot, root)`.
- Badge glyphs and meanings are exactly: `✎` "AI can read and edit", `👁` "AI can read only", `⊘` "AI can't see it".
- Default table for new projects: `canon` edit, `notes` edit, `outline` read, `drafts` read (and prose), `sessions` edit, `memory` read.
- Colours only from tokens in `src/renderer/src/theme/theme.css`. `contextIsolation: true`, `nodeIntegration: false`.

## Review Focus

1. **Path tricks against prose.** `drafts/../drafts/c.md`, `DRAFTS/c.md`, `./drafts/c.md`, and a symlink `canon/link → ../drafts` must all be refused for AI writes (Task 3: `refuses prose writes however the path is spelled`).
2. **A file override inside a prose folder.** A hand-edited `project.json` saying `"drafts/ch1.md": "edit"` must still be refused (Task 1: `prose clamps edit to read even with an explicit override`; Task 3 covers the write).
3. **Opening an existing v1 project writes nothing** until Done (Task 2: `opening a project without settings writes nothing`).
4. **A corrupt `project.json`** is never overwritten and grants no writes (Task 2: `an unreadable file is reported and never overwritten`; Task 3: `an unreadable settings file grants no writes`).
5. **Cycling back to the inherited value** removes the override, so later folder changes still apply to the file (Task 1: `cycling to the inherited value removes the override`).

---

### Task 1: Shared permission model

**Files:**
- Create: `src/shared/access.ts`, `src/shared/access.test.ts`
- Modify: `src/shared/types.ts`

**Interfaces:**
- Produces (`src/shared/types.ts`):
  ```ts
  export type Access = 'edit' | 'read' | 'hidden'
  export interface ProjectSettings { version: 1; prose: string[]; access: Record<string, Access> }
  export interface ProjectAccess {
    settings: ProjectSettings      // all-read empty settings when missing or unreadable
    needsProsePrompt: boolean      // true only when the file does not exist
    unreadable: boolean            // true when the file exists but failed to parse/validate
  }
  ```
- Produces (`src/shared/access.ts`):
  ```ts
  export const EMPTY_SETTINGS: ProjectSettings            // { version: 1, prose: [], access: {} }
  export const DEFAULT_PROJECT_SETTINGS: ProjectSettings   // the default table, prose ["drafts"]
  export const ACCESS_BADGE: Record<Access, { glyph: string; label: string }>
  export function isProse(s: ProjectSettings, relPath: string): boolean
  export function effectiveAccess(s: ProjectSettings, relPath: string): Access   // '' = project top level
  export function isExplicit(s: ProjectSettings, relPath: string): boolean
  export function nextAccess(s: ProjectSettings, relPath: string): Access         // the cycle
  export function withAccess(s: ProjectSettings, relPath: string, a: Access): ProjectSettings  // drops entry if equal to inherited
  export function withProse(s: ProjectSettings, prose: string[]): ProjectSettings  // drops edit entries at/under prose
  export function parseProjectSettings(raw: unknown): ProjectSettings | null       // null on wrong shape
  ```
- Matching is by whole segments: prose `drafts` covers `drafts` and `drafts/a.md` but not `drafts2/a.md`.

- [ ] **Step 1: Write failing tests** in `access.test.ts`:
  - `files inherit the nearest explicit entry`: with `{canon: 'edit', 'canon/x': 'hidden'}`, `canon/a.md` → edit, `canon/x/b.md` → hidden, `outline/o.md` → read (no entry)
  - `prose matches whole segments`: prose `['drafts']`: `drafts/c/1.md` true, `drafts2/a.md` false, `drafts` true
  - `prose clamps edit to read even with an explicit override`: prose `['drafts']`, access `{'drafts/ch1.md': 'edit', drafts: 'edit'}` → `effectiveAccess(..., 'drafts/ch1.md') === 'read'`
  - `cycle goes edit, read, hidden and skips edit for prose`: `nextAccess` from edit → read → hidden → edit; for a prose path read → hidden → read
  - `cycling to the inherited value removes the override`: `canon: 'edit'`; `withAccess(s, 'canon/a.md', 'read')` adds the entry; then `withAccess(that, 'canon/a.md', 'edit')` has no `canon/a.md` key and `isExplicit` is false
  - `marking prose drops edit overrides under it`: `withProse({access: {drafts: 'edit', 'drafts/a.md': 'hidden', canon: 'edit'}}, ['drafts'])` keeps `drafts/a.md: hidden` and `canon: edit` and drops `drafts`
  - `defaults match the spec table`: `DEFAULT_PROJECT_SETTINGS` equals `{version:1, prose:['drafts'], access:{canon:'edit',notes:'edit',outline:'read',drafts:'read',sessions:'edit',memory:'read'}}`
  - `parseProjectSettings rejects wrong shapes`: `null` for `null`, `[]`, `{version: 2,…}`, `{…, access: {canon: 'write'}}`, `{…, prose: 'drafts'}`, keys with a leading `/`, `..` segment or trailing `/`; accepts the defaults object
- [ ] **Step 2: Run** `npm test -- access` → FAIL (module missing).
- [ ] **Step 3: Implement** `access.ts` and the types. `ACCESS_BADGE` uses the exact glyphs and labels from Global Constraints.
- [ ] **Step 4: Run** `npm test -- access` → PASS; `npm run typecheck` → clean.
- [ ] **Step 5: Commit** `feat: shared AI permission model`.

---

### Task 2: Project settings file and IPC

**Files:**
- Create: `src/main/projectSettings.ts`, `src/main/projectSettings.test.ts`
- Modify: `src/main/projectFs.ts` (`createProject`), `src/main/projectFs.test.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/shared/types.ts`, `src/renderer/src/App.test.tsx` and any other test stubs of `window.canonball` / `ProjectInfo` so they typecheck

**Interfaces:**
- Consumes: Task 1's types, `parseProjectSettings`, `withAccess`, `withProse`, `DEFAULT_PROJECT_SETTINGS`, `EMPTY_SETTINGS`.
- Produces (`src/main/projectSettings.ts`):
  ```ts
  export const SETTINGS_REL = '.canonball/project.json'
  export function loadProjectAccess(root: string): Promise<ProjectAccess>
  export function saveProjectSettings(root: string, s: ProjectSettings): Promise<ProjectAccess>  // mkdir .canonball, atomic write
  export function setPathAccess(root: string, relPath: string, a: Access): Promise<ProjectAccess>
  export function setProsePaths(root: string, prose: string[]): Promise<ProjectAccess>
  ```
  `setPathAccess`/`setProsePaths` throw `Error('Project settings file is unreadable')` when the file is unreadable. `setPathAccess` on a project without the file starts from `EMPTY_SETTINGS`. Each argument path is validated with the same rule `parseProjectSettings` uses for keys (throw `Error('Invalid path')`). The atomic write reuses `projectFs.writeDoc` (it resolves inside the root).
- Produces (`src/shared/types.ts`): `ProjectInfo` gains `access: ProjectAccess`. `CanonballApi` gains:
  ```ts
  getProjectAccess(): Promise<ProjectAccess>
  setPathAccess(root: string, relPath: string, access: Access): Promise<ProjectAccess>   // 'Project changed' guard
  setProsePaths(root: string, prose: string[]): Promise<ProjectAccess>
  ```
  IPC channels `canonball:getProjectAccess`, `canonball:setPathAccess`, `canonball:setProsePaths`. Main checks `access` is one of the three strings and `prose` is a string array before calling.
- `createProject` writes `DEFAULT_PROJECT_SETTINGS` to `.canonball/project.json`.

- [ ] **Step 1: Write failing tests** in `projectSettings.test.ts` (temp dir per test):
  - `opening a project without settings writes nothing`: `loadProjectAccess` on a folder with `drafts/` → `needsProsePrompt: true`, settings equal `EMPTY_SETTINGS`, and `.canonball` does not exist afterward
  - `save then load round-trips with a trailing newline`: the file text ends in `}\n` and is 2-space indented
  - `an unreadable file is reported and never overwritten`: write `{oops` → `unreadable: true`, `needsProsePrompt: false`; `setPathAccess` and `setProsePaths` reject with `Project settings file is unreadable`; the file still reads `{oops`
  - `setPathAccess stores and clears overrides`: on defaults, `setPathAccess(root, 'canon/a.md', 'read')` → entry present; then `'edit'` → entry gone
  - `setProsePaths with nothing ticked still writes the file`: → `prose: []`, `needsProsePrompt: false` on reload
  - `rejects escaping paths`: `setPathAccess(root, '../x', 'read')` rejects

  And in `projectFs.test.ts`: `createProject writes default AI permissions`: the created `.canonball/project.json` parses to `DEFAULT_PROJECT_SETTINGS`, and `.gitignore` still contains `.canonball/chats/`.
- [ ] **Step 2: Run** `npm test -- projectSettings projectFs` → FAIL.
- [ ] **Step 3: Implement** `projectSettings.ts`, the `createProject` change, the IPC handlers (`openProject` includes `access: await loadProjectAccess(root)`), preload methods, and the types. Update test stubs so `npm run typecheck` passes.
- [ ] **Step 4: Run** `npm test` → PASS; `npm run typecheck` → clean.
- [ ] **Step 5: Commit** `feat: store AI permissions in .canonball/project.json`.

---

### Task 3: Main-process AI access layer

**Files:**
- Create: `src/main/aiAccess.ts`, `src/main/aiAccess.test.ts`

**Interfaces:**
- Consumes: `loadProjectAccess` (Task 2), `effectiveAccess`, `isProse` (Task 1), `resolveInside`, `listTree`, `readDoc`, `writeDoc` (`projectFs.ts`).
- Produces:
  ```ts
  export class AccessDenied extends Error {}   // name 'AccessDenied'
  export interface AiFile { relPath: string; access: 'edit' | 'read' }
  export interface AiAccess {
    canonicalize(relPath: string): string         // real on-disk relPath, '/'-separated; throws AccessDenied on escape
    list(): Promise<AiFile[]>                     // every .md file the AI can see, sorted by relPath
    read(relPath: string): Promise<DocFile>
    write(relPath: string, content: string): Promise<DocFile>   // existing file only
    create(relPath: string, content: string): Promise<DocFile>  // new file only; never overwrites
  }
  export function createAiAccess(root: string): AiAccess
  ```
- Denial messages (Phase 5 shows them to the model): `Prose is never edited by the AI: <relPath>`, `The writer has hidden this file from the AI: <relPath>`, `The AI may only read this file: <relPath>`, `The AI may not create files in this folder: <folder or "the project's top level">`, `Not available to the AI: <relPath>` (dot-paths, non-`.md`, escapes, missing file on read/write), `File already exists: <relPath>` on create. Unreadable settings → every write/create is denied with `Project settings file is unreadable`.
- Canonicalize: `resolveInside`, then `fs.realpathSync.native` on the deepest existing ancestor (this fixes letter case and follows symlinks on macOS), re-append the missing tail, and take the path relative to `fs.realpathSync.native(root)`. The prose and access checks run on that result. Checks are done after canonicalizing **and** settings are re-loaded on each call.
- `write` and `create` check the canonical path, then call `writeDoc(root, canonical, content)`. `create` makes no folders: the parent must exist.

- [ ] **Step 1: Write failing tests** in `aiAccess.test.ts`, on a temp project made with `createProject(tmp, 'template')` plus `drafts/chapters/c.md`:
  - `refuses prose writes however the path is spelled`: `write` rejects with `AccessDenied` matching `/Prose is never edited/` for `drafts/chapters/c.md`, `drafts/../drafts/chapters/c.md`, `./drafts/chapters/c.md`, `DRAFTS/Chapters/C.md`, and `canon/link/chapters/c.md` where `canon/link` is a symlink to `../drafts`; the file content is unchanged after all five
  - `refuses a hand-edited edit override in a prose folder`: write `project.json` with `"drafts/chapters/c.md": "edit"` → `write` still rejects `Prose is never edited`
  - `refuses creating files in prose`: `create('drafts/chapters/new.md', 'x')` rejects; the file does not exist
  - `writes and creates where allowed`: `write('canon/characters.md', 'x')` resolves and the disk has `x`; `create('notes/idea.md', 'y')` works; `create('notes/idea.md', 'z')` rejects `File already exists`
  - `read-only and hidden are enforced`: `write('outline/outline.md', …)` rejects `may only read`; set `memory` hidden via `setPathAccess` → `read('memory/style_rules.md')` rejects `hidden` and `list()` has no `memory/` entries
  - `file-level edit in a read folder allows editing that file only`: `setPathAccess(root, 'outline/outline.md', 'edit')` → `write` works; `create('outline/new.md', …)` rejects `may not create`
  - `dot-paths and non-markdown are never available`: `read('.canonball/project.json')`, `write('.gitignore', …)`, `create('canon/x.txt', …)` all reject `Not available to the AI`
  - `an unreadable settings file grants no writes`: write `{oops` to `project.json` → `write('canon/characters.md', …)` rejects `Project settings file is unreadable`, and `list()` still returns read entries
  - `list reports access per file`: on defaults, `canon/characters.md` has `edit`, `drafts/chapters/c.md` has `read`, nothing under `.canonball`
- [ ] **Step 2: Run** `npm test -- aiAccess` → FAIL.
- [ ] **Step 3: Implement** `aiAccess.ts`. It is not wired to IPC (Phase 5 does that); it must not be reachable from the renderer.
- [ ] **Step 4: Run** `npm test` → PASS; `npm run typecheck` → clean.
- [ ] **Step 5: Commit** `feat: main-process access layer that refuses AI writes to prose`.

---

### Task 4: Badges and legend in the tree

**Files:**
- Modify: `src/renderer/src/tree/FileTree.tsx`, `FileTree.test.tsx`, `src/renderer/src/App.tsx`, `App.test.tsx`, `src/renderer/src/assets/main.css`

**Interfaces:**
- Consumes: `ProjectAccess`, `ACCESS_BADGE`, `effectiveAccess`, `isExplicit`, `isProse`, `nextAccess` (Task 1); `getProjectAccess`, `setPathAccess` (Task 2).
- Produces: `FileTree(props: { tree; selected; onOpen; settings: ProjectSettings; onCycle(relPath: string): void })`.
- Each row becomes a `div.cb-row` holding the existing open/toggle `button` and a sibling badge `button.cb-badge` (no nested buttons). The badge shows `ACCESS_BADGE[a].glyph`, has `aria-label` `` `${label}. Click to change.` `` and `title` = label, and class `cb-badge-inherited` when not explicit. Prose rows show `<span class="cb-prose-tag">prose</span>` after the name. Below the tree, `<ul class="cb-legend" aria-label="AI access">` with the three glyph + label pairs.
- `App` keeps `access: ProjectAccess` (from `ProjectInfo.access`, refreshed with the tree on focus via `getProjectAccess`). `onCycle` calls `setPathAccess(root, relPath, nextAccess(settings, relPath))` and stores the result; on error it shows the message in the existing `cb-app-error` alert. When `access.unreadable`, the alert shows the unreadable copy from the Rulings.

- [ ] **Step 1: Write failing tests**
  - `FileTree.test.tsx`: `shows each row's effective badge` (defaults: `canon` row ✎ with label "AI can read and edit", `drafts` 👁, a file under `canon` ✎ and inherited); `clicking a badge cycles without opening the file` (`onCycle` called with the relPath, `onOpen` not called); `prose rows are tagged`; `the legend lists all three badges`
  - `App.test.tsx`: `clicking a badge saves the next access` (stub `setPathAccess` resolving with a new `ProjectAccess` where `canon` is `read`; after the click the `canon` badge shows 👁 and the stub was called with `(root, 'canon', 'read')`); `warns when project settings are unreadable`
- [ ] **Step 2: Run** `npm test -- FileTree App` → FAIL.
- [ ] **Step 3: Implement.** Badge colours: `--text` explicit, `--text-muted` inherited.
- [ ] **Step 4: Run** `npm test` → PASS; `npm run typecheck` and `npm run lint` → clean.
- [ ] **Step 5: Commit** `feat: AI permission badges in the project tree`.

---

### Task 5: Prose-folders dialog and settings-driven draft banner

**Files:**
- Create: `src/renderer/src/tree/ProseDialog.tsx`, `ProseDialog.test.tsx`
- Modify: `src/renderer/src/App.tsx`, `App.test.tsx`, `src/renderer/src/editor/Editor.tsx`, `Toolbar.tsx`, `Editor.test.tsx`, `src/shared/paths.ts`, `src/shared/paths.test.ts`, `src/renderer/src/assets/main.css`

**Interfaces:**
- Consumes: `setProsePaths` (Task 2), `isProse` (Task 1), `TreeNode`, `sortTree`, `displayName`.
- Produces: `ProseDialog(props: { tree: TreeNode[]; initial: string[]; onDone(prose: string[]): void })`, a `role="dialog"` `aria-modal="true"` overlay titled `Which folders hold your prose?` with the body `The AI can read prose to answer questions, but it will never edit it.` One checkbox per folder (all depths, indented, sorted with `sortTree`) and per top-level file (`displayName`), and a **Done** button. `initial` sets the ticks.
- `Editor` takes a new prop `isProse: boolean` and passes it to `Toolbar`, which shows the banner when it's true. `isProsePath` is deleted from `src/shared/paths.ts` (and its test).
- `App`: shows `ProseDialog` when `access.needsProsePrompt`, with `initial` = `['drafts']` if a top-level `drafts` folder exists, else `[]`. Done calls `setProsePaths(root, prose)` and stores the result. The tree footer gets a **Prose folders…** button that opens the dialog with `initial = access.settings.prose`. Passes `isProse(access.settings, selectedPath)` to `Editor`.

- [ ] **Step 1: Write failing tests**
  - `ProseDialog.test.tsx`: `lists folders at every depth and top-level files` (`drafts/chapters` and a top-level `book.md` appear, a nested file does not); `Done returns the ticked paths` (tick `manuscript`, untick `drafts` → `onDone(['manuscript'])`)
  - `App.test.tsx`: `asks which folders hold prose when the project has no settings` (stub `needsProsePrompt: true`; dialog shown with `drafts` ticked; Done calls `setProsePaths(root, ['drafts'])` and the dialog closes); `does not ask when settings exist`; `Prose folders… reopens the dialog`
  - `Editor.test.tsx`: replace the old banner test with `shows the draft banner when the file is prose` (rendered with `isProse` true and false)
- [ ] **Step 2: Run** `npm test` → the new tests FAIL.
- [ ] **Step 3: Implement.** The overlay uses theme tokens (`--bg`, `--border`, `--text`).
- [ ] **Step 4: Run** `npm test` → PASS; `npm run typecheck`, `npm run lint`, `npm run build` → clean.
- [ ] **Step 5: Commit** `feat: prose folders dialog and settings-driven draft banner`.
