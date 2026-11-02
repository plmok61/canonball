# Protected Files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-file AI access setting (edit / read-only / hidden) with a single rule: the AI reads everything, and never edits **protected** files. Protected files get their own section at the top of the left column, managed by right-click.

**Architecture:** A new pure module, `src/shared/protection.ts`, owns the settings format (version 2, `{ protected: [...] }`, with version 1 files read as legacy). The main-process access layer (`src/main/aiAccess.ts`) is still the only enforcer. The renderer splits the tree into a Protected section and a Project section, and asks main to show a native one-item menu on right-click.

**Tech Stack:** Electron, React, TypeScript, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-01-protected-files-design.md`

## Global Constraints

- User-facing word is **Protected**. Fixed copy:
  - Section heading `Protected`, caption `AI can read, never edit`
  - Empty hint `Right-click a folder or file to protect it from AI edits.`
  - Menu items `Protect from AI edits` and `Stop protecting`
  - Toolbar banner `Protected — AI won't edit`
  - Dialog title `Which folders should the AI never edit?`
  - Dialog body `Usually your drafts or chapters. The AI can still read them to answer questions. You can change this later by right-clicking a folder.`
- Settings file `.canonball/project.json`: write only `{ "version": 2, "protected": [...] }`. Read version 1 (`prose` becomes `protected`, `access` ignored). Never write on read.
- The AI can read every available `.md` file. Availability rules are unchanged: no dot-segments, no `node_modules`, only `.md`. It can never write or create under a protected entry. An unreadable settings file refuses every write and create, but not reads.
- No emoji or symbol characters as icons. Icons are inline SVG with `stroke="currentColor"` and no new dependency.
- The renderer reaches main only through `window.canonball`. Paths go through `resolveInside` and `validPath`.
- Hard rules stay: no continue-writing, rewrite-selection or ghost text, and every AI edit goes through Accept/Reject.

## Review Focus

1. **A protected entry that no longer exists on disk** (renamed or deleted folder): the left column doesn't crash or show a ghost row, and the AI still can't create a file at that path. Tests go in Task 1 (`isProtected`), Task 2 (`checkCreate`) and Task 4 (`splitTree`).
2. **Dismissing the right-click menu without choosing:** nothing is written. Tests go in Task 5 (`showTreeMenu` resolves `false`, App never calls `setProtectedPaths`).
3. **Protecting the folder that holds the open file:** the toolbar banner switches to Protected straight away, and the open file isn't saved because of it. Test in Task 4.
4. **A version 1 settings file with junk in `access`:** it loads normally, because `access` is ignored and the project isn't marked "unreadable". A version 1 file with a bad `prose` still counts as unreadable. Test in Task 1.
5. **A second right-click action while a save is in flight:** it's ignored, not queued, and causes no double write. Test in Task 5.

---

### Task 1: Shared protection model

**Files:**
- Create: `src/shared/protection.ts`
- Test: `src/shared/protection.test.ts`
- Modify: `src/shared/types.ts`, adding the new types beside the old ones. The old ones are removed in Task 2.

**Interfaces:**
- Produces, in `types.ts`:
  - `interface ProtectionSettings { version: 2; protected: string[] }`
  - `interface ProjectProtection { settings: ProtectionSettings; needsProtectPrompt: boolean; unreadable: boolean }`
- Produces, in `protection.ts`:
  - `EMPTY_SETTINGS: ProtectionSettings` (`protected: []`) and `DEFAULT_PROJECT_SETTINGS: ProtectionSettings` (`protected: ['drafts']`)
  - `validPath(p: unknown): p is string`, moved verbatim from `src/shared/access.ts`
  - `isProtected(s: ProtectionSettings, relPath: string): boolean`, true when `relPath` is an entry or lies under one, matching whole segments. `''` is never protected.
  - `normalizeProtected(paths: string[]): string[]`: dedupes, drops any entry under another entry, and keeps first-seen order
  - `addProtected(paths: string[], relPath: string): string[]`, which is `normalizeProtected([...paths, relPath])`
  - `removeProtected(paths: string[], relPath: string): string[]`, which removes only that exact entry
  - `parseProjectSettings(raw: unknown): ProtectionSettings | null`

- [ ] **Step 1: Write the failing tests** in `protection.test.ts`:
  - `isProtected({version:2, protected:['drafts']}, 'drafts/ch1.md')` is `true`. `'drafts2/x.md'` is `false`, `''` is `false`, and `'drafts'` is `true`.
  - `isProtected` for an entry `'gone'` that isn't in any tree, with the path `'gone/new.md'`, is `true`. Protection is by path, not by what's on disk.
  - `normalizeProtected(['book/ch', 'book', 'notes', 'book'])` equals `['book', 'notes']`.
  - `addProtected(['book/ch'], 'book')` equals `['book']`. `removeProtected(['a', 'b'], 'a')` equals `['b']`. `removeProtected(['a'], 'a/x')` equals `['a']`.
  - `parseProjectSettings({version:2, protected:['drafts']})` equals `{version:2, protected:['drafts']}`.
  - `parseProjectSettings({version:1, prose:['drafts'], access:{canon:'edit'}})` equals `{version:2, protected:['drafts']}`.
  - `parseProjectSettings({version:1, prose:['drafts'], access:{x:'bogus'}})` equals `{version:2, protected:['drafts']}` (Review Focus 4).
  - `parseProjectSettings({version:1, prose:['../x']})` and `({version:2, protected:'drafts'})` and `({version:3, protected:[]})` are all `null`.
  - Parsed `protected` lists are normalized: `{version:2, protected:['a','a/b']}` becomes `['a']`.

- [ ] **Step 2: Run** `npx vitest run src/shared/protection.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `protection.ts` and the two types. Leave `access.ts` untouched.

- [ ] **Step 4: Run** `npx vitest run src/shared/protection.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit** `feat: shared protection settings model`

### Task 2: Single rule in main, IPC and preload; remove the access feature

This task switches the whole app to the new model and deletes `src/shared/access.ts`. Renderer changes here are only what's needed to compile and to remove the badges. The new layout comes in Task 4.

**Files:**
- Modify: `src/shared/types.ts`: remove `Access`, `ProjectSettings`, `ProjectAccess`. `ProjectInfo.access` becomes `ProjectInfo.protection: ProjectProtection`.
  - `CanonballApi` loses `setPathAccess`. `getProjectAccess` becomes `getProjectProtection(): Promise<ProjectProtection>`, and `setProsePaths` becomes `setProtectedPaths(root: string, paths: string[]): Promise<ProjectProtection>`.
- Modify: `src/main/projectSettings.ts`:
  - `loadProjectAccess` becomes `loadProjectProtection(root): Promise<ProjectProtection>`, and `setProsePaths` becomes `setProtectedPaths(root, paths)`, which writes `{version:2, protected: normalizeProtected(paths)}`.
  - Delete `setPathAccess` and `editable`'s access use. Keep `serialized` and `saveProjectSettings`.
- Modify: `src/main/projectFs.ts`, importing `DEFAULT_PROJECT_SETTINGS` from `protection.ts`.
- Modify: `src/main/aiAccess.ts`: `AiFile` becomes `{ relPath: string; protected: boolean }`. The rules:
  - `list()` returns every available `.md` file. When settings are unreadable, every file is `protected: true`.
  - `read()` has no settings check.
  - `checkWrite` and `checkCreate` refuse when settings are unreadable (`Project settings file is unreadable`) or when `isProtected` holds (`Protected files are never edited by the AI: <path>`). Otherwise they allow anywhere, including the top level, still subject to the existing file and folder existence checks.
  - Keep the canonical-spelling expansion of entries, renamed from `prose`.
- Modify: `src/main/ai/tools.ts` so `list_files` lines read `<path>` or `<path> (protected, read only)`.
- Modify: `src/main/ai/fallback.ts` so the packed entry is `<file path="…" protected="true|false">`. Rename the `prose` parameter to `isProtected` in `fallback.ts`, `sessions.ts` and `chatService.ts`.
- Modify: `src/main/ai/instructions.ts`: both "Files in prose folders (drafts) can never be changed" lines become "Protected files (usually the writer's drafts) can never be changed". Leave the manuscript and sample-passage lines alone.
- Modify: `src/main/ipc.ts` (drop `isAccess` and the `setPathAccess` handler, rename the other two channels to `canonball:getProjectProtection` and `canonball:setProtectedPaths`) and `src/preload/index.ts`.
- Modify: `src/renderer/src/App.tsx` and `src/renderer/src/tree/FileTree.tsx`:
  - Delete `cycle`, `nextAccess`, `Badge`, the legend and `onCycle`.
  - Use `ProjectProtection` and `isProtected`.
  - Rename the `Editor` and `Toolbar` prop `isProse` to `isProtected`, with the new banner copy.
  - Delete the `.cb-badge*` CSS.
- Rename: `src/main/ai/proseGuard.e2e.test.ts` becomes `protectedGuard.e2e.test.ts`, with its `describe` text changed to "the AI never writes protected files".
- Delete: `src/shared/access.ts` and `src/shared/access.test.ts` (their surviving cases now live in `protection.test.ts`).
- Docs: in `CLAUDE.md`, the first hard rule becomes "**The AI never edits protected files** (the writer's drafts and anything else they protect)." followed by the unchanged "No continue-writing…" sentences.
  - In the design spec (`docs/superpowers/specs/2026-10-31-canonball-app-design.md`), replace the AI-access table and the ✎/👁/⊘ text with the single rule. Point to the new spec, and change the `.canonball/chats/` `.gitignore` reason to "transcripts quote the writer's drafts".
- Tests to update: `aiAccess.test.ts`, `projectSettings.test.ts`, `tools.test.ts`, `fallback.test.ts`, `sessions.test.ts`, `chatService.test.ts`, `instructions.test.ts`, `App.test.tsx`, `FileTree.test.tsx`.
  - Delete the badge and legend tests (`FileTree.test.tsx` "shows each row's effective badge", "clicking a badge cycles…", "the legend lists all three badges", and the App `setPathAccess` tests).

**Interfaces:**
- Consumes: Task 1's `protection.ts` and types.
- Produces: `loadProjectProtection`, `setProtectedPaths` (main), `window.canonball.getProjectProtection` and `window.canonball.setProtectedPaths`, `AiFile.protected`, and the `Editor`/`Toolbar` prop `isProtected`.

- [ ] **Step 1: Write the failing tests:**
  - `aiAccess.test.ts`:
    - "reads a file under a former hidden entry": the settings are a version 1 file with `access:{notes:'hidden'}`, and `read('notes/a.md')` resolves.
    - "writes outline/ which used to be read-only": `write('outline/a.md', 'x')` resolves.
    - "creates at the top level": `create('new.md', 'x')` resolves.
    - "refuses a create under a protected entry missing on disk": protected `['gone']`, then `checkCreate('gone/x.md')` rejects `AccessDenied` (Review Focus 1). It must be refused because the entry is protected, not merely because the folder is missing, so create `gone/` first in the test to prove it.
    - "unreadable settings refuse writes but allow reads".
    - "list marks protected files": protected `['drafts']`, and `list()` contains `{relPath:'drafts/ch1.md', protected:true}` and `{relPath:'canon/a.md', protected:false}`.
  - `projectSettings.test.ts`:
    - "loading a version 1 file never rewrites it": compare the bytes and mtime before and after `loadProjectProtection`.
    - "setProtectedPaths writes version 2 normalized": `['a','a/b']` produces the file contents `{"version": 2, "protected": ["a"]}` plus a newline.
  - `tools.test.ts`: `list_files` output contains `drafts/ch1.md (protected, read only)` and the bare line `canon/a.md`.

- [ ] **Step 2: Run** `npx vitest run src/main`. Expected: the new tests FAIL.

- [ ] **Step 3: Implement** every change in the Files list.

- [ ] **Step 4: Verify.** Run `npm test && npm run typecheck && npm run lint`. Expected: all pass. Also run `grep -rn "access\.ts\|effectiveAccess\|setPathAccess\|ACCESS_BADGE\|isProse\b" src`, which should print nothing.

- [ ] **Step 5: Commit** `feat: one rule — the AI reads everything and never edits protected files`

### Task 3: First-open dialog becomes ProtectDialog

**Files:**
- Rename: `src/renderer/src/tree/ProseDialog.tsx` becomes `ProtectDialog.tsx`, and its test file is renamed to match. The component is `ProtectDialog`, its title id is `cb-protect-title`, and it uses the dialog copy from Global Constraints.
- Modify: `src/renderer/src/App.tsx`:
  - The dialog shows only when `needsProtectPrompt && !unreadable`. Delete `proseOpen`, `openProse`, `closeProse` and the footer's "Prose folders…" button.
  - Rename `saveProse` to `saveProtected`, which calls `setProtectedPaths`.
  - The dialog never gets `onCancel`. Keep the props, because the component still supports cancelling.

**Interfaces:**
- Consumes: `window.canonball.setProtectedPaths` (Task 2).
- Produces: `ProtectDialog` with the same props as `ProseDialog`.

- [ ] **Step 1: Write the failing tests:**
  - `ProtectDialog.test.tsx`: the heading text equals the fixed title, and the body paragraph equals the fixed body.
  - `App.test.tsx`: "no Prose folders button": with a project open and the prompt not needed, `queryByRole('button', {name: /prose folders/i})` is null. "first open asks and saves": `needsProtectPrompt: true`, tick a folder, click Done, and `setProtectedPaths` is called with `('/p', ['drafts'])`.

- [ ] **Step 2: Run** `npx vitest run src/renderer/src/tree src/renderer/src/App.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run** the same command. Expected: PASS.

- [ ] **Step 5: Commit** `feat: first-open dialog asks what the AI should never edit`

### Task 4: Protected section at the top of the left column

**Files:**
- Create: `src/renderer/src/tree/splitTree.ts` and `splitTree.test.ts`.
- Modify: `src/renderer/src/tree/FileTree.tsx`, `FileTree.test.tsx` and `src/renderer/src/assets/main.css`. Add the section heading, caption, muted parent path and empty hint, using the existing theme tokens. Delete `.cb-prose-tag`.
- Modify: `src/renderer/src/App.tsx` to pass the new props.

**Interfaces:**
- Consumes: `isProtected` and `ProtectionSettings` (Task 1).
- Produces:
  - `interface ProtectedRoot { node: TreeNode; parentPath: string }`, where `parentPath` is `''` at the top level and otherwise `'book'` for `book/chapters`.
  - `splitTree(tree: TreeNode[], protectedPaths: string[]): { protectedRoots: ProtectedRoot[]; rest: TreeNode[] }`. Roots come in depth-first order over the given (already sorted) tree. Entries not found in the tree are skipped. `rest` is the tree with each root node removed, and a parent left empty stays as a folder with `children: []`.
  - `FileTree` props: `{ tree: TreeNode[]; selected: string | null; onOpen(relPath: string): void; protectedPaths: string[]; onRowMenu(relPath: string, inProtected: boolean): void }`.
    - `onRowMenu` fires from `onContextMenu` (with `preventDefault`) on every Project row, and on Protected root rows only. Rows inside a protected folder have no handler.
    - Markup: two `<section>`s with `aria-label="Protected"` and `aria-label="Project"`, each holding a `role="tree"`.

- [ ] **Step 1: Write the failing tests:**
  - `splitTree.test.ts`:
    - "top-level folder moves to protected": with protected `['drafts']`, `rest` has no `drafts`, and the roots are `[{node: drafts, parentPath: ''}]`.
    - "nested entry keeps its parent in rest": with protected `['book/ch']`, `rest` still has `book` without `ch`, and the root `parentPath` is `'book'`.
    - "protected file at top level".
    - "missing entry is skipped": with protected `['gone']`, the roots are `[]` and `rest` equals the input (Review Focus 1).
  - `FileTree.test.tsx`:
    - "protected items appear only in the Protected section": `within(getByRole('region', {name:'Protected'}))` has `drafts`, and the Project region doesn't.
    - "empty hint": with protected `[]`, the Protected region shows the fixed hint.
    - "caption": the fixed caption is shown.
    - "nested root shows its parent": the text `book` appears in the muted span, followed by `ch`.
    - "right-click calls onRowMenu": `fireEvent.contextMenu` on a Project row gives `('notes', false)`. On a Protected root it gives `('drafts', true)`. On `drafts/ch1` inside it, `onRowMenu` isn't called.
    - "files open from Protected": clicking `ch1` calls `onOpen('drafts/ch1.md')`.
  - `App.test.tsx` "protecting the open file's folder updates the banner" (Review Focus 3): open `notes/a.md`, rerender with `notes` protected through the `setProtectedPaths` resolution path from Task 5, or directly through state if Task 5 isn't done yet. The fixed banner text then appears, and `writeDoc` isn't called.

- [ ] **Step 2: Run** `npx vitest run src/renderer/src/tree src/renderer/src/App.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement** `splitTree` and the two-section `FileTree`, reusing the existing `Rows` component for both sections. Protected roots render with depth 0. For now, App passes `onRowMenu={() => {}}`.

- [ ] **Step 4: Run** the same command. Expected: PASS.

- [ ] **Step 5: Commit** `feat: Protected section at the top of the left column`

### Task 5: Right-click to protect or stop protecting

**Files:**
- Create: `src/main/treeMenu.ts` and `treeMenu.test.ts`.
- Modify: `src/main/ipc.ts`, `src/preload/index.ts`, `src/shared/types.ts`, `src/renderer/src/App.tsx` and `App.test.tsx`.

**Interfaces:**
- Consumes: `addProtected`, `removeProtected` (Task 1), `setProtectedPaths` (Task 2) and `FileTree.onRowMenu` (Task 4).
- Produces:
  - `type TreeMenuKind = 'protect' | 'unprotect'` in `types.ts`.
  - `buildTreeMenuTemplate(kind: TreeMenuKind, choose: () => void): MenuItemConstructorOptions[]`, one item labelled with the fixed menu copy.
  - `showTreeMenu(win: BrowserWindow, kind: TreeMenuKind): Promise<boolean>`: pops the menu and resolves `true` on click and `false` when it closes without a choice. Electron can call the popup `callback` before the item's `click`, so resolve `false` from the callback only after a `setTimeout(…, 0)`, and settle once.
  - IPC `canonball:showTreeMenu(kind)`, which validates `kind`, and `CanonballApi.showTreeMenu(kind: TreeMenuKind): Promise<boolean>`.

- [ ] **Step 1: Write the failing tests:**
  - `treeMenu.test.ts`:
    - "protect label": `buildTreeMenuTemplate('protect', fn)[0].label` is `'Protect from AI edits'`, and its `click` calls `fn`.
    - "unprotect label" is `'Stop protecting'`.
    - "showTreeMenu resolves false when closed without a choice" (Review Focus 2): mock `Menu.buildFromTemplate` to return `{ popup: ({callback}) => callback() }`, and the promise resolves `false`.
    - "resolves true when clicked even if the close callback came first".
  - `App.test.tsx`:
    - "right-click protect saves": with `showTreeMenu` resolving `true`, the contextmenu event on `notes` leads to `setProtectedPaths` being called with `('/p', ['drafts', 'notes'])`.
    - "stop protecting saves": the contextmenu event on the `drafts` root gives `('/p', [])`.
    - "dismissed menu writes nothing" (Review Focus 2): with `showTreeMenu` resolving `false`, `setProtectedPaths` isn't called.
    - "second action during a save is ignored" (Review Focus 5): `setProtectedPaths` returns a pending promise, two right-click protects happen, and `setProtectedPaths` is called exactly once.
    - "failed save shows the app error and leaves sections unchanged".

- [ ] **Step 2: Run** `npx vitest run src/main/treeMenu.test.ts src/renderer/src/App.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement.** In App, `onRowMenu` returns early when `saving.current` is set. Otherwise it awaits `showTreeMenu`, computes the next list with `addProtected` or `removeProtected`, and saves through the existing `saving` guard. State updates only after the save succeeds.

- [ ] **Step 4: Run** the same command. Expected: PASS.

- [ ] **Step 5: Commit** `feat: right-click to protect or stop protecting`

### Task 6: SVG icons, no-emoji guard, and wrap-up

**Files:**
- Create: `src/renderer/src/icons.tsx`, exporting `ChevronRight`, `ChevronDown` and `Gear`, each `(props: { size?: number }) => React.JSX.Element`. Each draws a 16px-default `<svg aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.5}>`.
- Create: `src/renderer/src/noEmoji.test.ts`.
- Modify: `src/renderer/src/tree/FileTree.tsx` (▸ ▾) and `src/renderer/src/chat/ChatHeader.tsx` (⚙). The button keeps its existing accessible label.
- Modify: `OPEN_WORK.md` and `COMPLETED_WORK.md`, recording this work as done.

- [ ] **Step 1: Write the failing test** `noEmoji.test.ts`:
  - Read every `.ts`, `.tsx` and `.css` file under `src/renderer/src` (excluding `*.test.*`) with `fs`.
  - Assert that none matches `/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{25A0}-\u{25FF}\u{2298}\u{FE0F}]/u`.
  - The failure message lists `file:line`.
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/noEmoji.test.ts`. Expected: FAIL, naming `FileTree.tsx` and `ChatHeader.tsx`. Fix any other file it names in the same way: an SVG icon, or plain words if it's text rather than an icon.
- [ ] **Step 3: Implement** the icons and replace the glyphs.
- [ ] **Step 4: Verify.** Run `npm test && npm run typecheck && npm run lint && npm run build`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: SVG line icons instead of symbol glyphs`
