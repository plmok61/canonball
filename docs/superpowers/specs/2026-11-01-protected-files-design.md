# Protected files and the left column

Date: 2026-11-01. Status: design, awaiting approval.

## Why

The left column has two problems.

1. **The per-file AI access setting is the wrong idea.** Each row has an edit / read-only / hidden badge (✎ 👁 ⊘). The writer can't think of a reason to hide a project file from the AI: having its help is the point of the app. The only line that matters is **what the AI may edit**.
2. **Marking prose is hard to find.** It lives behind a "Prose folders…" button in the footer that opens a modal checklist, far from the files it affects. Prose looks like any other folder in the tree apart from a small tag.

The writer also pointed out that "prose" is too narrow a word. They may have files they don't want the AI to edit that aren't prose. The new word is **Protected**.

## The rule

- The AI can **read** every file in the project that it can read today. The existing technical limits stay the same: only `.md` files, and nothing under dot-folders (`.canonball/`, `.git/`…) or `node_modules`.
- The AI can **never edit or create** anything that is **protected**. A protected entry is a folder (and everything under it) or a single file.
- Everything else can be edited, and every AI edit or new file is still shown to the writer as an Accept/Reject card.
- The edit / read-only / hidden setting goes away completely. That covers the per-row badges, the legend, clicking a badge to change it, the `setPathAccess` IPC, and the per-folder defaults (`outline/` and `memory/` used to start read-only and are now editable like everything else).

The main-process access layer (`src/main/aiAccess.ts`) is still the only place that enforces this. The protected check keeps all of its current hardening: canonical spelling, symlinks, letter case, and re-reading settings on every call.

## Goals

- A **Protected** section at the top of the left column lists everything protected. Protected items open from there and **no longer appear in the project tree below**.
- The writer can protect or unprotect from a right-click menu, without a dialog.
- No emoji or emoji-like glyphs as icons anywhere in the app.

## Non-goals

- Any read restriction for the AI. If one is ever needed, it comes back as a new, separate design.
- Any new AI writing ability. The existing hard rules stay: no continue-writing, no rewrite-selection, no ghost text, ever.
- Drag and drop into or out of the Protected section.

## Anti-goals

- The AI must never be able to edit a protected file, whatever the UI shows. A UI bug may show something wrongly, but the main-process guard must never let a write through.
- The app must not rewrite `.canonball/project.json` just because it was opened. It writes the file only when the writer changes what's protected (or answers the first-open dialog).

## Left column layout (top to bottom)

1. **Protected**: a heading with a one-line caption, "AI can read, never edit". Below it, each protected entry is a root item.
   - Folders expand and collapse like folders in the tree. Files open in the editor.
   - A protected entry nested inside another folder (for example `book/chapters`) shows its path, with the parent folder name in a muted colour before it.
   - When nothing is protected, the section shows the hint "Right-click a folder or file to protect it from AI edits."
2. **Project**: the existing tree, minus everything that is protected. A folder whose only contents were protected still shows, as an empty folder.
3. **Footer**: the theme picker only. The "Prose folders…" button is removed.

The selected file is highlighted wherever it appears. Sorting inside each section follows the existing `sortTree` rules.

## Right-click menu

- In **Project**, right-clicking any folder or file shows **Protect from AI edits**. *(Claude's call: any depth, not only top level. This is a superset of what the writer asked for, and matches the first-open dialog, which already lists nested folders.)*
- In **Protected**, right-clicking a protected entry (a root item of the section) shows **Stop protecting**. Items inside a protected folder have no menu, because you can't unprotect part of a folder.
- It is a native menu, like the spell-check menu (`src/main/contextMenu.ts`). The renderer asks main to show it through `window.canonball`, and main reports back which item was chosen. The renderer still never touches the disk directly.
- Protecting something inside an already-protected folder can't happen, because those items only appear in Protected. When something is protected, any protected entries nested under it are folded into it so the list stays minimal.
- A failed save shows the existing app error line. The section only changes once the save has succeeded.

## First-open dialog

This stays. Writers name their prose folders anything, so the app has to ask. It appears when a folder is opened that has no `.canonball/project.json`. New projects made from `template/` start with `drafts` protected and don't ask, which is the same as today. New wording:

- Title: "Which folders should the AI never edit?"
- Body: "Usually your drafts or chapters. The AI can still read them to answer questions. You can change this later by right-clicking a folder."

Its contents (folders at any depth, plus top-level files) and behaviour stay the same. The only way to change protection after the first open is the right-click menu.

## Settings file

`.canonball/project.json` becomes `{ "version": 2, "protected": ["drafts"] }`.

- **Reading version 1** files (`{ version: 1, prose: [...], access: {...} }`): `prose` becomes `protected`, and `access` is ignored. The file is not rewritten on read.
- **Writing** always produces version 2. That happens only when the writer changes protection.
- An unreadable or corrupt file behaves as it does today: the AI is refused every edit (fail closed), and the app shows the existing "unreadable" message. Reads are no longer gated by settings, because nothing is hidden any more. *(Claude's call.)*
- `DEFAULT_PROJECT_SETTINGS` for new projects becomes `{ version: 2, protected: ["drafts"] }`.

## Terminology

The user-facing word is **Protected** everywhere. "Prose" stays only where it really means the writer's prose.

- Editor toolbar banner: "Draft — AI won't edit" becomes "Protected — AI won't edit".
- AI instructions (`src/main/ai/instructions.ts`): "Files in prose folders (drafts) can never be changed" becomes "Protected files (usually the writer's drafts) can never be changed". Lines about never writing the manuscript stay as they are.
- AI tool results: `list_files` stops reporting edit/read access and instead marks each file as protected or not. Any error text the AI sees uses the word "protected".
- Code renames `prose` to `protected` (`isProtected`, `setProtectedPaths`, and so on), so the code matches the UI. `ProseDialog` becomes `ProtectDialog`.
- Docs: the CLAUDE.md hard rule becomes "The AI never edits protected files (the writer's drafts and anything else they protect)". The design spec's AI-access section and the Phase 3 notes are updated to the single rule. The reason given for the `.gitignore` entry for `.canonball/chats/` changes from hidden files to "transcripts quote the writer's drafts".

## Icons

No emoji or symbol characters as icons. The badges go away with the access feature. The folder arrows (▸ ▾ in `FileTree.tsx`) and the settings button (⚙ in `ChatHeader.tsx`) become small inline SVG line icons, drawn with `currentColor` so they follow the theme. *(Claude's call: hand-written inline SVG components, no new icon dependency.)* Each icon-only button keeps an accessible label.

## Tests

- **Access layer:** every write and create to a protected path is refused, however it's spelled (case, symlink, `..`). Everything not protected can be written. Reading works for any available `.md` file, whatever the settings say.
- **Settings:** version 1 files load with `prose` as protected and `access` ignored. Loading never writes. Saving writes version 2.
- **Left column:** protected entries appear only in Protected. Nested entries show their path. The empty hint shows when nothing is protected. Right-click protect and stop protecting call through to main and update both sections.
- **No emoji glyphs:** a test fails if renderer source contains the old glyphs or characters from the emoji ranges in JSX text.
- The existing end-to-end "never prose into drafts" test stays, renamed to protected.

## Left to the builder

- How the context-menu request and response travel over IPC, within the existing preload and `resolveInside` rules.
- Exact styling of the section headings, caption, muted parent path and icons, matching the current theme tokens.
- Whether `withProtected` minimisation (folding nested entries into their parent) lives in shared code or main.
