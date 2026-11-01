# File Tree Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** VS Code-style file management in the left column: right-click menus (new file or folder, rename, duplicate, cut, copy, paste, reveal, trash, protect), multi-select, drag and drop, and undo/redo for file actions.

**Architecture:**
- Pure shared helpers decide names, path remapping and menu contents.
- One main-process module, `src/main/fileOps.ts`, does every disk change behind new `window.canonball` calls. It keeps protected entries in step with moves, protecting the new path before the move, so the AI never sees a gap.
- Trash goes to a holding area, `.canonball/trash/`, that is flushed to the Mac Trash.
- The renderer owns selection, focus, the app clipboard and an undo history. Each history step records what main returned, so it can call the reverse operation.

**Tech Stack:** Electron, React, TypeScript, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-01-file-tree-actions-design.md`

## Global Constraints

- Menus are native, and items that don't apply are omitted. Labels, verbatim: `New File`, `New Folder`, `Rename`, `Duplicate`, `Cut`, `Copy`, `Paste`, `Reveal in Finder`, `Move to Trash`, `Protect from AI edits`, `Stop protecting`.
- The menu order and separators come from the spec's Menus table.
- Names must not be empty, contain `/` or `:`, start with `.`, or equal `node_modules`. New files are always `<name>.md`, never with `.md` added twice.
- Clash naming: `<name> copy.md`, then `<name> copy 2.md`, `<name> copy 3.md`, and so on. Folders follow the same pattern without `.md`. Nothing is ever overwritten.
- Trash confirmation text:
  - One item: `Move "<display name>" to the Trash?`
  - Several: `Move <N> items to the Trash?`
  - When any item is a folder, the detail line is `This includes everything in it.`
  - The OK button is `Move to Trash`.
- Undo errors use the app error line, in the form `Can't undo: <reason>`. A trash step whose holding item is gone gives `Can't undo: it's already in the Trash`. If the target is taken, it's `Can't undo: "<name>" already exists`.
- The undo-new-file confirmation is `Undo New File? "<name>" has text in it. It will go to the Trash.`, with the OK button `Undo`.
- Shortcuts apply only while the tree is focused: Return to rename, Cmd+C/X/V, Cmd+D, Cmd+Backspace, Cmd+Z, Cmd+Shift+Z, and Up/Down with or without Shift.
- The renderer reaches the disk only through `window.canonball`. Every path goes through `resolveInside` in main, and main refuses any path segment that starts with `.` or is `node_modules`, except its own internal use of `.canonball/trash/`.
- The app clipboard and undo history belong to the open project, and both are cleared when the project switches or closes.
- No emoji or symbol icons. Any new icon is inline SVG in `src/renderer/src/icons.tsx`.
- The AI never edits protected files, and `src/main/aiAccess.ts` is unchanged.

## Review Focus

1. **A case-only rename** (`chapter.md` to `Chapter.md`) on a case-insensitive disk really changes the case. It isn't refused as "already exists". Test in Task 2.
2. **Renaming or moving a folder that holds the open file while there's unsaved typing:** the typing is saved to the file, and the editor shows the new path. Test in Task 6.
3. **Moving or renaming a protected item:** at no moment does the AI guard treat the new path as unprotected. Main adds the new entry before the disk move and removes the old one after. Test in Task 2, which records the settings written before the rename.
4. **Pasting several items with the same name** (`a/x.md` and `b/x.md`) into one folder: they arrive as `x.md` and `x copy.md`, and nothing is overwritten. Test in Task 2.
5. **Undo after the disk changed:** the original path is now taken, or a trashed holding item is gone. Undo refuses with the fixed error, never overwrites, and drops the step. Test in Task 6.

---

### Task 1: Shared name, path and menu helpers

**Files:**
- Create: `src/shared/fileNames.ts` and `fileNames.test.ts`, `src/shared/treeMenuItems.ts` and `treeMenuItems.test.ts`.
- Modify: `src/shared/protection.ts` and `protection.test.ts` (add `remapProtected`), and `src/shared/types.ts`.

**Interfaces (Produces):**
- In `types.ts`:
  - `type EntryKind = 'file' | 'folder'`
  - `interface Move { from: string; to: string }`
  - `interface ProtectionDelta { added: string[]; removed: string[] }`
- In `fileNames.ts`:
  - `nameError(name: string): string | null`. The messages, in order of checks:
    - `Enter a name.`
    - `Names can't start with a dot.`
    - `Names can't contain / or :.`
    - `That name is reserved.` (for `node_modules`)
  - `withMd(name: string): string`. Case-insensitive check for an existing `.md`.
  - `copyName(name: string, kind: EntryKind, taken: (candidate: string) => boolean): string`. Returns the first free name from the pattern `<base> copy`, `<base> copy 2`, … with `.md` kept for files. It returns `name` itself if that isn't taken.
  - `isAtOrUnder(path: string, base: string): boolean`, which matches whole segments.
  - `remapPath(path: string, move: Move): string`
  - `topmost(paths: string[]): string[]`, which drops entries under another entry and keeps order.
- In `protection.ts`: `remapProtected(list: string[], moves: Move[]): string[]`, which remaps each entry through every move and then calls `normalizeProtected`.
- In `treeMenuItems.ts`:
  - `type TreeMenuItem = 'new-file' | 'new-folder' | 'rename' | 'duplicate' | 'cut' | 'copy' | 'paste' | 'reveal' | 'trash' | 'protect' | 'unprotect'`
  - `TREE_MENU_LABELS: Record<TreeMenuItem, string>`, with the Global Constraints labels.
  - `interface MenuTarget { kind: 'file' | 'folder' | 'empty' | 'multi'; protectRule: 'protect' | 'unprotect' | 'none'; canPaste: boolean }`
  - `menuFor(t: MenuTarget): (TreeMenuItem | '-')[]`, following the spec table. `'-'` is a separator. There are no leading, trailing or doubled separators.

- [ ] **Step 1: Write the failing tests:**
  - `nameError('')` gives `Enter a name.` `nameError('.x')` gives the dot message, `nameError('a/b')` and `nameError('a:b')` give the `/`/`:` message, and `nameError('Chapter 1')` is null.
  - `withMd('ch')` is `'ch.md'`, and `withMd('ch.MD')` is `'ch.MD'`.
  - `copyName('x.md','file', n => ['x.md','x copy.md'].includes(n))` is `'x copy 2.md'`. `copyName('notes','folder', n => n==='notes')` is `'notes copy'`.
  - `remapPath('book/ch/a.md', {from:'book', to:'novel'})` is `'novel/ch/a.md'`, and `remapPath('bookish/a.md', {from:'book', to:'novel'})` is unchanged.
  - `topmost(['a','a/b','c'])` is `['a','c']`.
  - `remapProtected(['drafts'], [{from:'drafts', to:'chapters'}])` is `['chapters']`. `remapProtected(['x','drafts'], [{from:'x', to:'drafts/x'}])` is `['drafts']`.
  - `menuFor({kind:'file', protectRule:'protect', canPaste:true})` is `['rename','-','duplicate','-','cut','copy','-','reveal','-','trash','-','protect']`. Paste never appears on a file.
  - `menuFor({kind:'folder', protectRule:'none', canPaste:false})` is `['new-file','new-folder','-','rename','-','cut','copy','-','reveal','-','trash']`.
  - `menuFor({kind:'empty', protectRule:'none', canPaste:true})` is `['new-file','new-folder','-','paste']`.
  - `menuFor({kind:'multi', protectRule:'unprotect', canPaste:false})` is `['cut','copy','-','trash','-','unprotect']`.
- [ ] **Step 2: Run** `npx vitest run src/shared`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run src/shared`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: shared helpers for file tree actions`

### Task 2: Main-process file operations

**Files:**
- Create: `src/main/fileOps.ts` and `fileOps.test.ts`, using real temp directories like `projectFs.test.ts`.
- Modify: `src/main/projectSettings.ts`, adding `remapProtection` and `changeProtectionMany`, with tests in `projectSettings.test.ts`.

**Interfaces:**
- Consumes: Task 1 helpers, plus `resolveInside`, `listTree`, `loadProjectProtection`, `saveProjectSettings`, `serialized`, `addProtected`, `removeProtected` and `normalizeProtected`.
- Produces, in `types.ts`:
  - `interface TrashedItem { id: string; from: string; protectedEntries: string[] }`
  - `interface FileOpResult { tree: TreeNode[]; protection: ProjectProtection }`
- Produces, in `fileOps.ts`. Each function takes `root` first, validates every relPath (`validPath`, no dot-segment, no `node_modules`) and new names (`nameError`), and returns `FileOpResult` plus the extras listed:
  - `createEntry(root, kind: EntryKind, parentRel: string, name: string)` returns `{ relPath: string }`. `parentRel` of `''` means the top level. For a file it uses `withMd`. It refuses an existing name with `"<name>" already exists`.
  - `renameEntry(root, relPath, newName)` returns `{ move: Move }`. Files keep `.md` (the caller passes the name without it). A case-only change goes through a temporary name in the same folder.
  - `pasteEntries(root, mode: 'copy' | 'move', relPaths: string[], destRel: string)` returns `{ created: string[]; moves: Move[] }`.
    - It applies `topmost` first. Clashes use `copyName`, including clashes among the pasted items themselves.
    - It refuses a folder pasted into itself or one of its own subfolders, with `Can't move a folder into itself.`
    - A move into the item's own folder is skipped.
  - `duplicateEntries(root, relPaths)` returns `{ created: string[] }`, each item created next to its original using `copyName`.
  - `moveExact(root, moves: Move[])` moves exactly as given. It refuses before touching anything if any `to` exists, with `"<name>" already exists`. Undo and redo use it.
  - `trashEntries(root, relPaths)` returns `{ trashed: TrashedItem[] }`. Each item moves to `.canonball/trash/<id>/<name>`, where `id` is `crypto.randomUUID()`. `protectedEntries` lists the protected entries at or under the item, which are removed from settings.
  - `restoreEntries(root, items: TrashedItem[])`: before anything moves, it refuses if any `from` exists (`"<name>" already exists`) or any holding item is missing (`it's already in the Trash`). It re-adds `protectedEntries` before moving each item back.
  - `removeCreated(root, relPaths)` moves created items into the holding area and returns `{ trashed: TrashedItem[] }`. It's the same as `trashEntries`, under a separate name so the history reads clearly.
- Produces, in `projectSettings.ts`:
  - `remapProtection(root, moves: Move[], phase: 'before' | 'after'): Promise<ProjectProtection>`, inside `serialized`.
    - `'before'` adds the remapped new entries alongside the old ones.
    - `'after'` writes exactly `remapProtected(fresh, moves)`.
    - Neither writes when nothing changes.
  - Every move in `fileOps.ts` (rename, move-paste and `moveExact`) calls `'before'`, then the disk move, then `'after'`.
  - `changeProtectionMany(root, kind: TreeMenuKind, relPaths: string[]): Promise<{ protection: ProjectProtection; delta: ProtectionDelta }>`, where the delta is the exact entries added and removed.
  - `applyProtectionDelta(root, delta: ProtectionDelta): Promise<{ protection: ProjectProtection; applied: ProtectionDelta }>`. It applies the delta to the fresh file, adding `added` and removing `removed`, normalized. `applied` is what actually changed. Undo passes the reverse delta.

- [ ] **Step 1: Write the failing tests in `fileOps.test.ts`:**
  - "creates a file with .md once": creating `Chapter 4.md` gives `relPath: 'drafts/Chapter 4.md'`, an empty file.
  - "case-only rename works" (Review Focus 1): renaming `drafts/ch.md` to `Ch` lists `Ch.md` in a readdir, with no error.
  - "rename refuses an existing name": the error message is `"b.md" already exists`.
  - "paste copies with unique names" (Review Focus 4): copying `a/x.md` and `b/x.md` into `c` gives created `['c/x.md', 'c/x copy.md']`, and both originals are unchanged.
  - "paste move refuses into itself": moving `book` into `book/ch` rejects with the fixed message, and nothing moves.
  - "moving a protected folder never leaves a gap" (Review Focus 3): protected `['drafts']`. Rename `drafts` to `chapters` with a spy on `saveProjectSettings`. The first save contains both `drafts` and `chapters`, and the final file holds `['chapters']`.
  - "trash keeps the item in the holding area and drops protection": trashing protected `drafts` gives one `TrashedItem` with `protectedEntries: ['drafts']`. The folder exists under `.canonball/trash/<id>/drafts`, and settings hold `[]`.
  - "restore puts it back with protection": settings hold `['drafts']` again.
  - "restore refuses when the original path is taken" (Review Focus 5): it rejects `"drafts" already exists`, and the holding item is still there.
  - "restore refuses when the holding item is gone": it rejects `it's already in the Trash`.
  - "moveExact refuses if a target exists, before moving anything".
  - "rejects dot names and escapes": `createEntry(root, 'file', '', '.x')` and `renameEntry(root, '../x', 'y')` both reject.
- [ ] **Step 2: Write the failing tests in `projectSettings.test.ts`:** `changeProtectionMany` returns the right delta when protecting `book` folds `book/ch` (`added:['book'], removed:['book/ch']`), and `applyProtectionDelta` with the reverse delta restores `['book/ch']`.
- [ ] **Step 3: Run** `npx vitest run src/main/fileOps.test.ts src/main/projectSettings.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement.** Use `fs.promises.cp(…, { recursive: true, errorOnExist: true, force: false })` for copies and `rename` for moves. Moves never cross devices: the holding area is inside the project.
- [ ] **Step 5: Run** the same command. Expected: PASS.
- [ ] **Step 6: Commit** `feat: main-process file operations that keep protection in step`

### Task 3: IPC, holding-area flush and dialogs

**Files:**
- Modify: `src/main/ipc.ts`, `src/preload/index.ts`, `src/shared/types.ts`, `src/main/index.ts` and `src/main/projectFs.ts` (the new-project `.gitignore`).
- Modify: `src/main/treeMenu.ts` and `treeMenu.test.ts`. The menu is generalized, and the old `TreeMenuKind`-only signature is replaced.
- Create: `src/main/trashFlush.ts` and `trashFlush.test.ts`.

**Interfaces (Produces, on `CanonballApi`):**
- One method per Task 2 function, each taking `root` first and checked with `requireCurrentRoot`: `createEntry`, `renameEntry`, `pasteEntries`, `duplicateEntries`, `moveExact`, `trashEntries`, `restoreEntries`, `removeCreated`, `changeProtectionMany` and `applyProtectionDelta`.
- `revealEntry(root, relPath): Promise<void>`, which uses `shell.showItemInFolder(resolveInside(...))`.
- `showTreeMenu(items: (TreeMenuItem | '-')[]): Promise<TreeMenuItem | null>`. The settle-once rule is unchanged: a click wins over the close callback.
- `confirmDialog(opts: { message: string; detail?: string; ok: string }): Promise<boolean>`, which uses `dialog.showMessageBox` with the buttons `[ok, 'Cancel']`.
- `nativeUndo(): void` and `nativeRedo(): void`, which call `webContents.undo()` / `redo()` on the sender. These are used by Task 7.
- `trashFlush.ts` exports `flushHoldingArea(root: string, trashItem: (fullPath: string) => Promise<void>): Promise<void>`. It moves every `.canonball/trash/<id>/*` to the Mac Trash, removes the emptied `<id>` folders, and treats a missing holding area as a no-op.
- Main calls `flushHoldingArea` with `shell.trashItem` from `openProject` (for the root being opened and for the root being left) and in `before-quit` for the current root.
- New projects' `.gitignore` is `.canonball/chats/` followed by `.canonball/trash/`, one per line.
- The existing `showTreeMenu(kind)` and `changeProtection` callers in `App.tsx` move to the new API, which keeps today's behaviour: the protect and unprotect items call `changeProtectionMany` with one path.

- [ ] **Step 1: Write the failing tests:**
  - `trashFlush.test.ts`: "flushes each holding item and removes its folder", with a fake `trashItem` that records paths; and "no holding area is fine".
  - `treeMenu.test.ts`: `buildTreeMenuTemplate(['rename','-','trash'], choose)` gives labels `Rename`, then a separator, then `Move to Trash`. Clicking `trash` calls `choose('trash')`. The close callback alone resolves `null`.
  - `projectFs.test.ts`: the new project's `.gitignore` equals `.canonball/chats/\n.canonball/trash/\n`.
- [ ] **Step 2: Run** `npx vitest run src/main`. Expected: FAIL.
- [ ] **Step 3: Implement** the IPC handlers, with argument type checks like the existing ones, plus the preload, types, flush wiring and the `App.tsx` call-site update.
- [ ] **Step 4: Verify.** Run `npm test && npm run typecheck && npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: file operation IPC, holding-area flush and generalized tree menu`

### Task 4: Selection, focus and inline name editing in the tree

**Files:**
- Create: `src/renderer/src/tree/selection.ts` and `selection.test.ts`, `src/renderer/src/tree/NameEditor.tsx` and `NameEditor.test.tsx`.
- Modify: `src/renderer/src/tree/FileTree.tsx`, `FileTree.test.tsx` and `src/renderer/src/assets/main.css`.

**Interfaces (Produces):**
- `selection.ts`:
  - `interface Selection { paths: string[]; anchor: string | null }`
  - `visibleOrder(protectedRoots: TreeNode[], rest: TreeNode[], isOpen: (relPath: string, depth: number) => boolean): string[]`, giving rows top to bottom as rendered.
  - `clickSelect(sel: Selection, relPath: string, mods: { meta: boolean; shift: boolean }, order: string[]): Selection`
  - `arrowSelect(sel: Selection, dir: 1 | -1, shift: boolean, order: string[]): Selection`
- `NameEditor` props: `{ initial: string; selectStem: boolean; onSubmit(name: string): Promise<string | null>; onCancel(): void }`.
  - `onSubmit` resolves to an error message to show inline (keeping the box open), or `null` to close.
  - It checks `nameError` locally before calling `onSubmit`. Return submits, and Escape or blur cancels.
- `FileTree` props become:
  - `{ tree; protectedPaths; selection: Selection; onSelect(next: Selection, open?: string): void; onMenu(target: { relPath: string | null; inProtectedRoot: boolean }): void; onKey(e: React.KeyboardEvent): void; onFocusChange(focused: boolean): void; cutPaths: string[]; editing: { mode: 'rename'; relPath: string } | { mode: 'new'; kind: EntryKind; parentRel: string } | null; onEditSubmit(name: string): Promise<string | null>; onEditCancel(): void; drag: DragHandlers }`
  - `DragHandlers` is defined in Task 8. Until then, it is an optional prop, left unused.
  - The whole column is one focusable container (`tabIndex={0}`), which reports focus in and out.
  - Every row, including rows inside protected folders, calls `onMenu`. Empty space below the rows calls `onMenu({ relPath: null, … })`.
  - Selected rows get `cb-row-selected`, and cut rows get `cb-row-cut` (faded, using `opacity` and theme tokens).
  - A `new` editing row renders at the top of `parentRel`'s children (that folder is expanded), or at the top of Project for `''`.
  - Extra prop `moves: Move[]`, the moves from the latest action. When it changes, `FileTree` remaps its collapse state through them with `remapPath`, so expanded folders stay expanded after a rename or move.

- [ ] **Step 1: Write the failing tests:**
  - `selection.test.ts`:
    - Cmd-click toggles.
    - Shift-click selects the range between the anchor and the target in `order`.
    - A plain click resets to one row.
    - `arrowSelect` moves and extends.
  - `NameEditor.test.tsx`:
    - The rename of `ch.md` shows `ch` with only `ch` selected.
    - Return with `a/b` shows `Names can't contain / or :.` without calling `onSubmit`.
    - When `onSubmit` resolves to an error string, that error shows and the box stays open.
    - Escape calls `onCancel`.
  - `FileTree.test.tsx`:
    - Right-click on `drafts/ch1` (inside a protected root) calls `onMenu({relPath:'drafts/ch1.md', inProtectedRoot:false})`.
    - Right-click on empty space calls `onMenu({relPath:null, …})`.
    - Cut rows have the class `cb-row-cut`.
    - "expanded folders stay expanded after a rename": expand `book/ch`, rerender with the tree renamed to `novel/ch` and `moves=[{from:'book', to:'novel'}]`, and `novel/ch` is still expanded.
    - Focusing and blurring the tree container calls `onFocusChange(true)`, then `onFocusChange(false)`.
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/tree`. Expected: FAIL.
- [ ] **Step 3: Implement.** The existing collapse state stays inside `FileTree`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat: multi-select, focus and inline naming in the file tree`

### Task 5: Undo history

**Files:**
- Create: `src/renderer/src/tree/history.ts` and `history.test.ts`.

**Interfaces:**
- Consumes: the Task 3 `CanonballApi` methods and the types `Move`, `TrashedItem` and `ProtectionDelta`.
- Produces:
  - `type Step`, with these variants:
    - `{ kind: 'create'; label: string; created: string[] }` (new file, new folder, duplicate and copy-paste)
    - `{ kind: 'move'; label: string; moves: Move[] }` (rename, cut-paste and drag)
    - `{ kind: 'trash'; label: string; items: TrashedItem[] }`
    - `{ kind: 'protect'; label: string; delta: ProtectionDelta }`
    - a `{ kind: 'removed'; …; items: TrashedItem[] }` variant for undone creates, internal to redo
  - `interface History { push(step: Step): void; undo(): Promise<Step | null>; redo(): Promise<Step | null>; canUndo(): boolean; canRedo(): boolean; clear(): void }`
  - `createHistory(root: string, api: Pick<CanonballApi, 'moveExact' | 'restoreEntries' | 'removeCreated' | 'applyProtectionDelta' | 'trashEntries'>, onResult: (r: FileOpResult) => void): History`. It calls `onResult` after each successful undo or redo.
  - How undo reverses each step:
    - `create` calls `removeCreated(created)`, and redo calls `restoreEntries` of what that returned.
    - `move` calls `moveExact` with the moves swapped and reversed. Redo calls `moveExact` with the originals.
    - `trash` calls `restoreEntries(items)`, and redo calls `trashEntries(items.map(i => i.from))`, replacing `items` with the new result.
    - `protect` calls `applyProtectionDelta({added: delta.removed, removed: delta.added})`, and redo applies `delta`.
  - On any API rejection, the step is dropped from history, and `undo`/`redo` rejects with `Can't undo: <main's message>` (or `Can't redo: …`). `push` clears the redo stack.

- [ ] **Step 1: Write the failing tests** with a fake api built from `vi.fn()`:
  - "undo of a rename moves it back" calls `moveExact` with `[{from:'b.md', to:'a.md'}]`.
  - "undo of trash restores" calls `restoreEntries` with the items.
  - "undo of a create removes it, redo restores it".
  - "undo of protect applies the reverse delta".
  - "a failed undo drops the step and reports" (Review Focus 5): `moveExact` rejects `'"a.md" already exists'`. `undo()` rejects `Can't undo: "a.md" already exists`, and then `canUndo()` is false.
  - "a new push clears redo".
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/tree/history.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat: undo and redo history for file actions`

### Task 6: Wire the actions into the app

**Files:**
- Create: `src/renderer/src/tree/useFileActions.ts`.
- Modify: `src/renderer/src/App.tsx` and `src/renderer/src/App.test.tsx`.

**Interfaces:**
- Consumes: Tasks 1 through 5.
- Produces:
  - `useFileActions({ project, protection, selection, setSelection, selectedPath, setSelectedPath, setTree, setProtection, setError })`, which returns `{ onMenu, onKey, editing, onEditSubmit, onEditCancel, cutPaths, onFocusChange, treeFocused: boolean, undo(): Promise<void>, redo(): Promise<void> }`.
  - App passes these to `FileTree`.
  - The clipboard (`{ mode: 'copy' | 'cut'; paths: string[] } | null`) and the history are created per project root, and cleared when the root changes.
- Behaviour:
  - **Before any action:** if the action touches the open file or one of its parent folders, call `flushAll()` first.
  - **After a move:** `setSelectedPath(remapPath(selectedPath, move))` for each move. After a trash or remove that covers the open file, `setSelectedPath(null)`.
  - **Reveal in Finder** calls `revealEntry`. It's not undoable and not guarded by `saving`.
  - **New file:** opens the created file and selects it. New folder expands. Rename keeps the row selected.
  - **Menu targets:**
    - A right-click on a row outside the selection selects only that row first.
    - `protectRule` is `'protect'` when every target is in Project, `'unprotect'` when every target is a Protected root, and `'none'` otherwise. That includes any row inside a protected folder.
    - `kind` is `'multi'` when the selection has more than one item.
    - `canPaste` is true when the clipboard is non-empty.
  - **Paste destination:** the folder for a folder target, the file's parent folder for a file target, and `''` for empty space.
  - **Trash:** first `confirmDialog` with the fixed copy. Then `trashEntries`, then push a `trash` step.
  - **Undo of a create:** if any created file is non-empty (`readDoc`), first `confirmDialog` with the fixed undo-new-file copy.
  - **Keys:** while `treeFocused`, `onKey` handles the Global Constraints shortcuts and calls `preventDefault` on them.
  - Every main call goes through the existing `saving` ref guard. A second action while one is in flight is ignored.

- [ ] **Step 1: Write the failing tests in `App.test.tsx`** (mocks for the new api methods):
  - "rename the open file keeps it open at the new path": right-click `notes/a.md`, choose `rename`, type `b`, then Return. `renameEntry('/p','notes/a.md','b')` is called, and the editor's path label shows `notes/b.md`.
  - "renaming a folder that holds the open file saves first" (Review Focus 2): with the `flushAll` spy as in existing tests, `flushAll` is called before `renameEntry`.
  - "trash asks first": `confirmDialog` gets `{ message: 'Move "a" to the Trash?', ok: 'Move to Trash' }`. If it resolves false, `trashEntries` is not called.
  - "copy then paste into a folder": Cmd+C on `notes/a.md` with the tree focused, select `canon`, then Cmd+V. `pasteEntries('/p','copy',['notes/a.md'],'canon')` is called.
  - "Cmd+Z in the tree undoes the rename": `moveExact` is called with the reversed move.
  - "undo failure shows the error line" (Review Focus 5): `moveExact` rejects, and `Can't undo: "a.md" already exists` is shown.
  - "keys do nothing when the tree is not focused": Cmd+Backspace with focus in the editor doesn't call `trashEntries`.
  - "switching projects clears the clipboard": after Cmd+C, switch project, then Cmd+V does nothing.
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/App.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** Run `npm test && npm run typecheck && npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: file actions from the tree menu and keyboard`

### Task 7: Route Edit-menu Undo/Redo by focus

**Files:**
- Modify: `src/main/menu.ts`, `menu.test.ts`, `src/shared/types.ts` (`MenuCommand` gains `'undo' | 'redo'`), `src/renderer/src/App.tsx` and `App.test.tsx`.

**Interfaces:**
- Consumes: `useFileActions().treeFocused`, `undo` and `redo` (Task 6), and `nativeUndo`/`nativeRedo` (Task 3).
- Produces:
  - The Edit menu's `{ role: 'undo' }` and `{ role: 'redo' }` are replaced by `{ label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send('undo') }` and `{ label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', click: () => send('redo') }`.
  - App handles `'undo'` as `treeFocused ? undo() : window.canonball.nativeUndo()`, and `'redo'` the same way.
  - The tree's own `onKey` no longer handles Cmd+Z or Cmd+Shift+Z, because the menu accelerator does. Update Task 6's "Cmd+Z in the tree undoes the rename" test to send the `undo` menu command instead.
  - The labels stay `Undo` and `Redo`. Native menu labels are fixed at build time, so the spec's "Undo <action>" wording is shortened to `Undo`.

- [ ] **Step 1: Write the failing tests:**
  - `menu.test.ts`: the Edit menu has items labelled `Undo` and `Redo` with those accelerators, and clicking them calls `send('undo')` and `send('redo')`.
  - `App.test.tsx`: the menu command `undo` with the tree focused calls `moveExact` after a rename. With the editor focused it calls `nativeUndo` and not `moveExact`. With the tree focused and nothing to undo, it calls neither.
- [ ] **Step 2: Run** `npx vitest run src/main/menu.test.ts src/renderer/src/App.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat: Edit-menu Undo and Redo follow focus`

### Task 8: Drag and drop

**Files:**
- Create: `src/renderer/src/tree/dragDrop.ts` and `dragDrop.test.ts`.
- Modify: `src/renderer/src/tree/FileTree.tsx`, `FileTree.test.tsx`, `src/renderer/src/tree/useFileActions.ts`, `src/renderer/src/assets/main.css` and `App.test.tsx`.

**Interfaces:**
- Produces:
  - `dropTarget(dragged: string[], over: { relPath: string | null; kind: EntryKind | null }): string | null`. It returns the destination folder relPath, with `''` for the top level, or `null` when the drop isn't allowed. A file target means its parent folder. It refuses a folder onto itself or one of its descendants, and a drop where every item is already in that folder.
  - `DragHandlers` is `{ onDragStart(relPath: string): void; onDragOver(target: { relPath: string | null; kind: EntryKind | null }): boolean; onDrop(target: …, copy: boolean): void; onDragEnd(): void }`.
  - `useFileActions` implements these handlers:
    - Dragging a selected row drags the whole selection. Dragging an unselected row selects it.
    - Drop calls `pasteEntries(mode: copy ? 'copy' : 'move')` and pushes a history step.
    - Option held at drop time means copy.
  - The row under the pointer gets `cb-row-drop`. A folder hovered for 1000 ms expands.
  - Rows use the HTML5 `draggable` attribute with the `dragstart`, `dragover`, `drop` and `dragend` events. The data type is internal, `application/x-canonball-paths`.

- [ ] **Step 1: Write the failing tests:**
  - `dragDrop.test.ts`:
    - `dropTarget(['notes/a.md'], {relPath:'canon', kind:'folder'})` is `'canon'`.
    - `dropTarget(['book'], {relPath:'book/ch', kind:'folder'})` is `null`.
    - `dropTarget(['notes/a.md'], {relPath:'notes/b.md', kind:'file'})` is `null`, because it's the same folder.
    - `dropTarget(['notes/a.md'], {relPath:null, kind:null})` is `''`.
  - `App.test.tsx`:
    - "drag a file onto a folder moves it": `fireEvent.dragStart` on `notes/a.md`, then `dragOver` and `drop` on `canon`. `pasteEntries('/p','move',['notes/a.md'],'canon')` is called.
    - "option-drop copies": `drop` with `altKey: true` calls it with mode `'copy'`.
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/tree src/renderer/src/App.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** Run `npm test && npm run typecheck && npm run lint && npm run build`. Expected: PASS.
- [ ] **Step 5: Update** `OPEN_WORK.md`/`COMPLETED_WORK.md` (record file tree actions as completed, with the spec and plan paths) and commit `feat: drag and drop in the file tree`.
