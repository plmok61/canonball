# Phase 2: Writing Aids Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spelling and grammar problems show as underlines with suggestions. Nothing is ever fixed unless the writer picks a fix. The phase also keys the save registry by project root + relPath.

**Architecture:** Spelling is Chromium's built-in checker. Main builds a right-click menu from Electron's `context-menu` params. Grammar is Harper (`harper.js`, WASM) running in an Electron `utilityProcess` so it never blocks the renderer or main. The renderer sends paragraph texts over IPC and gets lints back. A TipTap extension maps those lints to ProseMirror decorations, and a small popover offers the fixes. Decorations are view-only, so linting can never change the document or trigger a save.

**Tech Stack:** Electron 44 (`utilityProcess`, `webContents` `context-menu`), harper.js 2.13.0 (`LocalLinter`, `harper.js/binary`), TipTap 3 / ProseMirror decorations, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-31-canonball-app-design.md` (sections "How it gets made", "The screen", "Goals"). The previous phase's interfaces are in `docs/superpowers/plans/2026-10-31-phase-1-editor-shell.md`. Fix commits changed some of them, and the code is the authority: `writeDoc` is now `writeDoc(root, relPath, content)`, and `Editor` takes `{ root, relPath }`.

## Global Constraints

- **Flag-only.** No code path changes the writer's text unless the writer clicks a suggestion. No auto-correct, and no "fix all".
- **Offline.** Harper loads its WASM from the local `harper.js` package with `fs`. No network calls.
- `harper.js` is pinned **exactly** at `2.13.0` (already installed on this branch). 3.0.0 was published 2026-10-27 and is too new.
- Harper's `SpellCheck` rule is **off**, because Chromium owns spelling. With it on, American mode also flags "grey" and similar words. Dialect: American (Harper's default).
- Harper spans are UTF-16 offsets into the string passed in (verified: `'🙂🙂 i went'` → span 5–6), so they index JS strings directly.
- The app never writes a file the writer didn't change. Lint decorations are set with meta-only transactions (`addToHistory: false`, no doc change).
- The renderer reaches main only through `window.canonball`. Validate every IPC argument in main.
- Colours come only from tokens in `src/renderer/src/theme/theme.css`, with a light and a dark value each. Dark values are never pure white or black.
- Keep `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: false` (unchanged).

## Review Focus

1. **Typing while a lint is in flight.** A late result must never underline the wrong words. Results for a doc that has since changed are dropped (Task 5: `drops results for a document that changed while linting`).
2. **Non-ASCII prose** (emoji, accents, em dashes, curly quotes, text split across bold/italic) must underline exactly the flagged characters (Task 3: emoji span test; Task 4: `maps offsets across marks and astral characters`).
3. **The grammar checker failing** (WASM load error, process crash) must leave typing, saving and spelling untouched. The next request restarts the checker (Task 3: `rejects pending requests and restarts after the process exits`; Task 5: `a failed lint leaves the document and existing underlines alone`).
4. **Long chapters.** Re-linting after one keystroke sends only the paragraphs whose text changed (Task 5: `only sends paragraphs whose text changed`). The IPC request is size-capped (Task 3).
5. **Non-prose content** (template hint comments, raw HTML, footnote refs, inline code) is never underlined by either checker (Task 2: `hints and raw nodes opt out of spellcheck`; Task 4: `masks inline atoms and code`).

---

### Task 1: Save registry keyed by project root + relPath

**Files:**
- Modify: `src/renderer/src/editor/saveRegistry.ts`, `src/renderer/src/editor/Editor.tsx:67,95`
- Create: `src/renderer/src/editor/saveRegistry.test.ts`

**Interfaces:**
- Produces: `orphan(root: string, relPath: string, autosave: Autosave): void` and `settleOrphan(root: string, relPath: string): Promise<string | null>`. The internal map key is `` `${root}\0${relPath}` ``. `registerLive`, `flushAll` and `__resetSaveRegistryForTests` are unchanged.

- [ ] **Step 1: Write failing tests** in `saveRegistry.test.ts`. Build a real `Autosave` with a `save` that rejects, `change('unsaved text')`, then `orphan(...)`:
  - `a stuck save is adopted when the same file in the same project reopens`: `settleOrphan('/p1', 'canon/a.md')` → `'unsaved text'`
  - `a stuck save is never adopted by the same path in another project`: `orphan('/p1', 'canon/a.md', a)`, then `settleOrphan('/p2', 'canon/a.md')` → `null`, and `flushAll(null)` still attempts `a` (its `save` mock was called again)
- [ ] **Step 2: Run** `npm test -- saveRegistry` → FAIL (wrong arity / adopted across projects).
- [ ] **Step 3: Implement** the new signatures and update both call sites in `Editor.tsx` to pass `root`.
- [ ] **Step 4: Run** `npm test` → all PASS. `npm run typecheck` → clean.
- [ ] **Step 5: Commit** `fix: key orphaned saves by project root and path`.

---

### Task 2: Spellcheck with right-click suggestions

**Files:**
- Create: `src/main/contextMenu.ts`, `src/main/contextMenu.test.ts`
- Modify: `src/main/index.ts` (webPreferences + `context-menu` listener), `src/renderer/src/editor/extensions.ts` (`hintAttributes`, `rawAttributes`), `src/renderer/src/editor/Editor.tsx` (`useEditor` `editorProps.attributes`), `src/renderer/src/editor/Editor.test.tsx`

**Interfaces:**
- Produces (`contextMenu.ts`):
  ```ts
  export interface ContextMenuParams {
    misspelledWord: string
    dictionarySuggestions: string[]
    isEditable: boolean
    selectionText: string
    editFlags: { canCut: boolean; canCopy: boolean; canPaste: boolean }
  }
  export interface SpellActions {
    replaceMisspelling(word: string): void
    learnWord(word: string): void
  }
  export function buildContextMenuTemplate(p: ContextMenuParams, a: SpellActions): MenuItemConstructorOptions[]
  ```
- Menu contents, in order:
  - If `misspelledWord` is set: up to **5** suggestions (label = the suggestion, click → `replaceMisspelling`). With no suggestions, one disabled item `No Guesses Found`. Then `Learn Spelling` (click → `learnWord(misspelledWord)`), then a separator.
  - If `isEditable`: `cut`, `copy` and `paste` roles, each `enabled` from `editFlags`.
  - Otherwise, if `selectionText` is non-empty: the `copy` role only.
  - Otherwise `[]`, and main shows no menu.
- Wiring in `index.ts`: `webPreferences.spellcheck: true`. Listen with `mainWindow.webContents.on('context-menu', (_e, params) => …)`. If the template is non-empty, call `Menu.buildFromTemplate(t).popup({ window: mainWindow })`. The actions are `webContents.replaceMisspelling(w)` and `webContents.session.addWordToSpellCheckerDictionary(w)`.
- Renderer: the ProseMirror element gets `spellcheck="true" autocorrect="off" autocapitalize="off"`. `.cb-hint` and `.cb-raw` nodes get `spellcheck="false"`.

- [ ] **Step 1: Write failing tests**
  - `contextMenu.test.ts`:
    - `offers at most five suggestions that replace the misspelling`: with 7 suggestions there are 5 items, and clicking the 2nd calls `replaceMisspelling` with suggestion 2
    - `says No Guesses Found when there are no suggestions`: that item is `enabled: false`
    - `Learn Spelling adds the word to the dictionary`
    - `editable fields get cut, copy and paste, enabled per editFlags`
    - `read-only selections get copy only`
    - `no misspelling, not editable, no selection: empty menu`
  - `Editor.test.tsx`:
    - `the page is spellchecked and never autocorrected`: `.ProseMirror` has `spellcheck="true"` and `autocorrect="off"`
    - `hints and raw nodes opt out of spellcheck`: load `'<!-- hint -->\n\nText <span>x</span>\n'`, and every `.cb-hint, .cb-raw` has `spellcheck="false"`
- [ ] **Step 2: Run** `npm test` → the new tests FAIL.
- [ ] **Step 3: Implement** `contextMenu.ts`, the attributes, and the `index.ts` wiring.
- [ ] **Step 4: Run** `npm test` → PASS. Run `npm run typecheck` and `npm run lint` → clean.
- [ ] **Step 5: Commit** `feat: spellcheck with right-click suggestions`.

---

### Task 3: Harper grammar checker in a utility process

**Files:**
- Create: `src/main/grammar/harperLinter.ts`, `harperLinter.test.ts`, `grammarService.ts`, `grammarService.test.ts`, `grammarWorker.ts`
- Modify: `src/shared/types.ts`, `src/main/ipc.ts`, `src/main/index.ts`, `src/preload/index.ts`

**Interfaces:**
- Produces (`src/shared/types.ts`):
  ```ts
  export interface GrammarSuggestion { label: string; replacement: string }
  export interface GrammarLint {
    start: number        // UTF-16 offset into the text that was linted
    end: number
    problem: string      // the flagged text, text.slice(start, end)
    message: string
    kind: string         // Harper's lint_kind_pretty()
    suggestions: GrammarSuggestion[]   // replacement covers [start, end)
  }
  // CanonballApi gains:
  lintGrammar(texts: string[]): Promise<GrammarLint[][]>   // one array per input text, same order
  ```
- Produces (`harperLinter.ts`):
  - `toGrammarLint(lint: HarperLintLike): GrammarLint`. `HarperLintLike` is the structural subset `{ span(): { start: number; end: number }; get_problem_text(): string; message(): string; lint_kind_pretty(): string; suggestions(): { kind(): number; get_replacement_text(): string }[] }`. Suggestions are normalized to a replacement for the whole span, deduplicated by `replacement`, at most **5**:

    | Harper kind | `replacement` | `label` |
    |---|---|---|
    | `0` Replace | the text | the text; `Fix spacing` if it is whitespace-only |
    | `1` Remove | `''` | `Remove "<problem>"`; `Remove the extra space` if `problem` is whitespace-only |
    | `2` InsertAfter | `problem + text` | `Add "<text>"` |

  - `createHarperLinter(): Promise<TextLinter>`, where `interface TextLinter { lint(texts: string[]): Promise<GrammarLint[][]> }`. It uses dynamic `import('harper.js')` and `import('harper.js/binary')`, `new LocalLinter({ binary, dialect: Dialect.American })`, and `setup()`. Then it takes `getLintConfig()`, sets `SpellCheck: false`, and passes the full config back to `setLintConfig`. Each text is linted with `{ language: 'plaintext' }`.
- Produces (`grammarService.ts`):
  - `MAX_LINT_CHARS = 200_000`. `parseLintRequest(input: unknown): string[]` throws `Error('Invalid grammar request')` unless the input is an array of strings whose total length is ≤ `MAX_LINT_CHARS`.
  - `interface GrammarChild { postMessage(msg: unknown): void; on(event: 'message', cb: (msg: unknown) => void): unknown; on(event: 'exit', cb: (code: number) => void): unknown; kill(): boolean }`. Electron's `UtilityProcess` satisfies it.
  - `createGrammarService(fork: () => GrammarChild): { lint(texts: string[]): Promise<GrammarLint[][]>; dispose(): void }`. It forks lazily on the first `lint` and sends `{ id: number; texts: string[] }`. The reply `{ id; lints?: GrammarLint[][]; error?: string }` resolves or rejects the matching request. On `exit`, every pending request rejects with `Error('Grammar checker stopped')`, and the next `lint` forks again. `dispose()` kills the child.
- `grammarWorker.ts` is the utility-process entry. It creates the linter once (lazily, memoized promise), handles each `process.parentPort` message, and replies with lints or `error: message`.
- Wiring:
  - `index.ts` imports `grammarWorkerPath from './grammar/grammarWorker?modulePath'` and creates `createGrammarService(() => utilityProcess.fork(grammarWorkerPath, [], { serviceName: 'Canonball Grammar' }))`. It passes the service to `registerIpc(grammar)` and calls `dispose()` on `will-quit`. This bundling pattern was verified in a spike: harper loads and lints inside a forked utility process from `electron-vite build` output.
  - `registerIpc(grammar: { lint(texts: string[]): Promise<GrammarLint[][]> }): void`. `ipc.ts` handles `canonball:lintGrammar` as `(_e, texts) => grammar.lint(parseLintRequest(texts))`. It does not need an open project.
  - Preload: `lintGrammar: (texts) => ipcRenderer.invoke('canonball:lintGrammar', texts)`.

- [ ] **Step 1: Write failing tests**
  - `harperLinter.test.ts` runs the real Harper. Create the linter once in `beforeAll`, with a timeout of 30 s:
    - `flags a repeated word with a fix that removes the repeat`: `'She went to the the store.'` → one lint with `problem === 'the the'` and a suggestion whose `replacement === 'the'`
    - `spans are UTF-16 offsets`: `'🙂🙂 i went home.'` → a lint with `start === 5`, `end === 6`, `problem === 'i'`
    - `leaves spelling to Chromium`: `'Her eyes are grey.'` and `'A xylofrabble sat.'` → `[]` for both
    - `returns one result array per text, in order`: `['Fine.', 'i went.']` → `[[], [one lint]]`
  - Also in `harperLinter.test.ts`, `toGrammarLint` with hand-made `HarperLintLike` objects:
    - `normalizes Remove and InsertAfter to whole-span replacements` (problem `','`, InsertAfter `' and'` → replacement `', and'`, label `Add " and"`)
    - `labels whitespace fixes in words` (Replace `' '` → `Fix spacing`)
    - `dedupes and caps suggestions at five`
  - `grammarService.test.ts`, with a fake `GrammarChild` built on an `EventEmitter`:
    - `does not start the process until the first lint`
    - `matches replies to requests by id` (two requests answered in reverse order)
    - `rejects a request whose reply carries an error`
    - `rejects pending requests and restarts after the process exits`: fork count 2 after the next `lint`
    - `parseLintRequest rejects non-arrays, non-strings and oversize requests`
- [ ] **Step 2: Run** `npm test -- grammar` → FAIL.
- [ ] **Step 3: Implement** the types, the three modules, and the wiring.
- [ ] **Step 4: Run** `npm test` → PASS. Run `npm run typecheck` and `npm run lint` → clean. Run `npm run build` → succeeds, and `out/main/chunks/` contains the grammar worker chunk.
- [ ] **Step 5: Commit** `feat: Harper grammar checker running offline in a utility process`.

---

### Task 4: Paragraph text and position map for linting

**Files:**
- Create: `src/renderer/src/grammar/blocks.ts`, `src/renderer/src/grammar/blocks.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface TextBlock {
    text: string
    offsets: number[]   // length text.length + 1; offsets[i] = doc position of char i, last = block content end
    masked: boolean[]   // length text.length; true for chars that stand in for non-prose
  }
  export function collectBlocks(doc: ProseMirrorNode): TextBlock[]
  /** Doc range for a lint span, or null if the span is empty or touches a masked char. */
  export function toDocRange(block: TextBlock, start: number, end: number): { from: number; to: number } | null
  ```
- Rules:
  - One `TextBlock` per textblock node (paragraphs, headings, and paragraphs inside lists, quotes and table cells), except `codeBlock`.
  - Text nodes contribute their characters at their own positions.
  - Text carrying a `code` mark becomes masked spaces of the same length.
  - `hardBreak` becomes an unmasked `'\n'`.
  - Any other inline leaf (`htmlCommentInline`, `rawInline`, `image`) becomes one masked `' '` at the leaf's position.
  - `to` is `offsets[end - 1] + 1`.

- [ ] **Step 1: Write failing tests**, using a headless `new Editor({ extensions: createExtensions() })` with markdown loaded through `loadIntoEditor`:
  - `one block per paragraph, heading, list item and table cell; none for code blocks`
  - `maps offsets across marks and astral characters`: `'She **🙂 go** home.\n'`. The range for `'go'` (found with `text.indexOf`) satisfies `doc.textBetween(from, to) === 'go'`.
  - `masks inline atoms and code`: in `'Eyes are <!-- decide --> grey and `x` here.\n'`, the comment and `x` positions are masked, and `toDocRange` over them → `null`
  - `hard breaks become newlines`
- [ ] **Step 2: Run** `npm test -- blocks` → FAIL.
- [ ] **Step 3: Implement** `blocks.ts` (`doc.descendants`, stopping descent at each textblock).
- [ ] **Step 4: Run** `npm test -- blocks` → PASS.
- [ ] **Step 5: Commit** `feat: map paragraph text to editor positions for grammar checks`.

---

### Task 5: Grammar underlines extension

**Files:**
- Create: `src/renderer/src/grammar/grammarExtension.ts`, `src/renderer/src/grammar/grammarExtension.test.ts`

**Interfaces:**
- Consumes: `collectBlocks`, `toDocRange` (Task 4); `GrammarLint` (Task 3).
- Produces:
  ```ts
  export interface GrammarOptions { lint: (texts: string[]) => Promise<GrammarLint[][]>; delayMs: number }
  export const Grammar: Extension<GrammarOptions>          // name 'grammar'
  export const grammarKey: PluginKey
  export interface FoundLint { from: number; to: number; lint: GrammarLint }
  export function grammarLintAt(state: EditorState, pos: number): FoundLint | null
  export function applyGrammarSuggestion(editor: Editor, found: FoundLint, replacement: string): boolean
  export function ignoreGrammarLint(editor: Editor, found: FoundLint): void
  ```
- Behavior:
  - **Plugin state** is a `DecorationSet`, mapped through every transaction. A transaction with `grammarKey` meta replaces it. That transaction also sets `addToHistory: false` and never changes the doc.
  - **Scheduling.** Every doc change (including the initial `setContent`) restarts a `delayMs` debounce. When it fires: `collectBlocks`, then one `lint` call with only the texts not in the cache (a `Map<string, GrammarLint[]>`, cleared when it passes **2000** entries). It then rebuilds decorations for all blocks from the cache, but only if `view.state.doc` is still the doc it collected from. Otherwise the result is dropped. A rejected `lint` is logged with `console.warn` and leaves state alone.
  - **Decorations.** `Decoration.inline(from, to, { class: 'cb-grammar' }, { lint })`, skipping lints for which `toDocRange` returns null and lints whose `` `${problem}\0${message}` `` key is ignored.
  - **`applyGrammarSuggestion`** first checks that `doc.textBetween(from, to) === lint.problem` and returns `false` if not. Otherwise it dispatches `tr.insertText(replacement, from, to)` (or `delete` when the replacement is empty), a normal undoable edit, and returns `true`.
  - **`ignoreGrammarLint`** adds the key to the editor's ignore set (session only, not saved) and removes matching decorations right away.

- [ ] **Step 1: Write failing tests**, using a headless editor with `[...createExtensions(), Grammar.configure({ lint: fake, delayMs: 0 })]`. The fake flags every `'the the'`. Wait for decorations with `vi.waitFor`.
  - `underlines the span the linter reports`: the decoration range text is `'the the'`
  - `decorations never change the document or add undo history`: doc JSON is unchanged, and `undoDepth(state) === 0`
  - `only sends paragraphs whose text changed`: in a 3-paragraph doc, typing into paragraph 2 → the second `lint` call receives exactly 1 text
  - `drops results for a document that changed while linting`: hold the fake's promise, insert text, then resolve. No decoration from the stale result.
  - `a failed lint leaves the document and existing underlines alone`
  - `applying a suggestion replaces only the flagged text and can be undone`
  - `apply does nothing when the flagged text has changed`
  - `ignore removes the underline and it stays away after re-linting`
- [ ] **Step 2: Run** `npm test -- grammarExtension` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** `feat: grammar underlines from Harper lints`.

---

### Task 6: Grammar popover in the editor

**Files:**
- Create: `src/renderer/src/grammar/GrammarPopover.tsx`, `src/renderer/src/grammar/grammar.css`
- Modify: `src/renderer/src/editor/Editor.tsx`, `src/renderer/src/editor/Editor.test.tsx` (the `stub()` gains `lintGrammar`, default `async (texts) => texts.map(() => [])`), `src/renderer/src/theme/theme.css`

**Interfaces:**
- Consumes: `Grammar`, `grammarLintAt`, `applyGrammarSuggestion`, `ignoreGrammarLint` (Task 5); `window.canonball.lintGrammar` (Task 3).
- Produces: `GrammarPopover(props: { editor: TipTapEditor }): React.JSX.Element | null`.
- `Editor.tsx`: extensions become `[...createExtensions(), Grammar.configure({ lint: (t) => window.canonball.lintGrammar(t), delayMs: 500 })]`, and `<GrammarPopover editor={editor} />` renders after `EditorContent`.
- Popover behavior:
  - **Opening.** A `click` or `contextmenu` on an element inside `.cb-grammar` within `editor.view.dom` opens it. `contextmenu` calls `preventDefault()` so the native menu does not also open. `click` does not prevent default, so the caret still moves.
  - **Finding the lint.** `grammarLintAt(state, view.posAtDOM(target, 0))`.
  - **Markup.** `<div role="dialog" aria-label="Grammar suggestion" className="cb-grammar-popover">` containing a `<p>` with the message, one `<button>` per suggestion label, and an `Ignore` button. Buttons use `onMouseDown={e => e.preventDefault()}` so the editor keeps focus.
  - **Placement.** `position: fixed` at the target's `getBoundingClientRect()` bottom-left + 4 px.
  - **Closing.** Escape, a `mousedown` outside the popover, any doc-changing transaction, or a scroll of `.cb-page-scroll`.
- Theme tokens: `--lint-grammar` is `#2b6cb0` in light and `#7fa8d8` in dark. Underline style: `text-decoration: underline wavy var(--lint-grammar); text-decoration-skip-ink: none; text-underline-offset: 3px`. The popover uses `--bg`, `--border` and `--text`.

- [ ] **Step 1: Write failing tests** in `Editor.test.tsx`. Stub `lintGrammar` to flag `'the the'` with suggestion `{ label: 'the', replacement: 'the' }`.
  - `linting never writes the file`: load `'She saw the the cat.\n'`, wait for `.cb-grammar`, flush the timers past 800 ms, and `writeDoc` is not called
  - `clicking an underline shows the message and fixes; choosing one fixes the text and saves`: click `.cb-grammar`, the dialog shows the message, click `the`, the doc text is `'She saw the cat.'`, and `writeDoc` is called once with content containing `She saw the cat.`
  - `right-clicking an underline opens the popover and suppresses the native menu`: the `contextmenu` event has `defaultPrevented === true`
  - `Escape closes the popover without changing the text`
  - `Ignore removes the underline`
- [ ] **Step 2: Run** `npm test -- Editor` → FAIL.
- [ ] **Step 3: Implement** the popover, the CSS, the tokens, and the `Editor.tsx` wiring.
- [ ] **Step 4: Run** `npm test` → PASS. Run `npm run typecheck` and `npm run lint` → clean. The theme hex grep (`grep -rn '#[0-9a-fA-F]\{3,6\}' src/renderer --include=*.css --include=*.tsx`) shows only `theme.css`.
- [ ] **Step 5: Commit** `feat: grammar suggestions popover`.

---

### Task 7: Check it in the real app, then close the phase

**Files:**
- Modify: `OPEN_WORK.md`, `COMPLETED_WORK.md`, `docs/superpowers/plans/2026-10-31-roadmap.md` (Phase 2's Plan cell becomes `2026-10-31-phase-2-writing-aids.md`)

- [ ] **Step 1: Manual check in `npm run dev`** with a scratch project (not `examples/`). Type `She go to the the store with a teh cat.`
  - Red spelling squiggle on `teh`. Right-click shows suggestions, and picking `the` fixes it.
  - Grammar underlines on `go` and `the the`. Clicking shows the message and fixes, and a fix applies only on click.
  - Right-clicking elsewhere gives Cut/Copy/Paste.
  - Opening an untouched file, waiting 5 s, and closing it leaves its mtime unchanged.
  - Repeat in dark theme.
- [ ] **Step 2: Packaged check.** `npm run build:unpack`, then open the built `.app` under `dist/` and confirm grammar underlines appear. Harper's Node loader reads the WASM from `new URL(...).pathname` inside `app.asar`. If this fails, or the build itself can't run here, record it under "Notes for later phases" for Phase 7 rather than fixing packaging now.
- [ ] **Step 3: Update docs.**
  - `OPEN_WORK.md`: remove the Phase 2 line and the save-registry note.
  - Add to "Notes for later phases":
    - harper.js is pinned at 2.13.0 and runs in a `utilityProcess` (`src/main/grammar/`).
    - Harper's `SpellCheck` rule is off and the dialect is fixed to American; a dialect setting is future work.
    - Ignored grammar lints last for the session only.
    - The grammar popover is mouse-only; keyboard access is future work.
    - Harper's Node loader uses `URL.pathname`, so a project install path containing spaces would break WASM loading (affects dev checkouts, not `/Applications`).
    - The Step 2 packaged result.
  - `COMPLETED_WORK.md`: add `Phase 2: Writing aids — Chromium spellcheck with right-click suggestions, Harper grammar underlines and fixes (flag-only), save registry keyed by project`.
- [ ] **Step 4: Run** `npm test`, `npm run lint` and `npm run build` → all pass.
- [ ] **Step 5: Commit** `docs: complete phase 2`.
