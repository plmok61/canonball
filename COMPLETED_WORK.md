# Completed Work

Finished work on the Canonball desktop app, newest first.

## 2026-11-01

- [x] File tree actions — right-click menu and keyboard shortcuts for new file/folder, rename, duplicate, cut/copy/paste, move to Trash, protect; multi-select; undo and redo (tree focus and Edit menu); drag rows onto folders to move, Option-drag to copy, hover a folder to open it. Spec: `docs/superpowers/specs/2026-11-01-file-tree-actions-design.md`; plan: `docs/superpowers/plans/2026-11-01-file-tree-actions.md`
- [x] Protected files and the left column — one rule (the AI reads everything and never edits protected files) replaces the per-file edit / read-only / hidden setting; a Protected section at the top of the left column, right-click to protect or stop protecting, first-open dialog, SVG icons instead of symbol glyphs. Spec: `docs/superpowers/specs/2026-11-01-protected-files-design.md`; plan: `docs/superpowers/plans/2026-11-01-protected-files.md`
- [x] Phase 6: Brainstorm sessions — start a session with a goal from the chat header; the v1 brainstorm stance, the readable canon and notes, and the last log's Next Session go into the AI's instructions; End session drafts a `sessions/session-N.md` log from the template as an Accept/Reject card, plus one canon card per locked-in decision; stacked edits to one file can be accepted one after another

## 2026-10-31

- [x] Phase 5: AI file tools & proposals — `list_files`/`read_file`/`propose_edit`/`create_note` gated by the access layer, Accept/Reject cards with a line diff, writes only on Accept (through `aiAccess`, after a content check), prompt fallback for models without tool calling, `memory/` (style rules, names to avoid) in the AI's instructions, end-to-end tests that the AI never writes prose
- [x] Phase 4: AI connection & chat — Anthropic/OpenAI/Google keys in the Keychain via `safeStorage`, one local OpenAI-compatible URL, live model picker, streaming chat panel with Stop, chats saved in `.canonball/chats/` with a `.gitignore`, File › Settings…
- [x] Phase 3: AI permissions — ✎/👁/⊘ badges with folder defaults and file overrides, prose folders and the first-open prose dialog, `.canonball/project.json`, and the main-process access layer that refuses every AI write to prose
- [x] Phase 2: Writing aids — Chromium spellcheck with right-click suggestions, Harper grammar underlines and fixes (flag-only), save registry keyed by project
- [x] Phase 1: Editor shell — open/create projects, file tree, WYSIWYG markdown editor with autosave, light/dark/system themes
- [x] Brainstormed the app: three-panel layout, dark mode, AI permissions, brainstorm sessions, BYO AI, Harper grammar
- [x] Drafted design doc: `docs/superpowers/specs/2026-10-31-canonball-app-design.md`
