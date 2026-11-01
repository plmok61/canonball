# Completed Work

Finished work on the Canonball desktop app, newest first.

## 2026-10-31

- [x] Phase 5: AI file tools & proposals — `list_files`/`read_file`/`propose_edit`/`create_note` gated by the access layer, Accept/Reject cards with a line diff, writes only on Accept (through `aiAccess`, after a content check), prompt fallback for models without tool calling, `memory/` (style rules, names to avoid) in the AI's instructions, end-to-end tests that the AI never writes prose
- [x] Phase 4: AI connection & chat — Anthropic/OpenAI/Google keys in the Keychain via `safeStorage`, one local OpenAI-compatible URL, live model picker, streaming chat panel with Stop, chats saved in `.canonball/chats/` with a `.gitignore`, File › Settings…
- [x] Phase 3: AI permissions — ✎/👁/⊘ badges with folder defaults and file overrides, prose folders and the first-open prose dialog, `.canonball/project.json`, and the main-process access layer that refuses every AI write to prose
- [x] Phase 2: Writing aids — Chromium spellcheck with right-click suggestions, Harper grammar underlines and fixes (flag-only), save registry keyed by project
- [x] Phase 1: Editor shell — open/create projects, file tree, WYSIWYG markdown editor with autosave, light/dark/system themes
- [x] Brainstormed the app: three-panel layout, dark mode, AI permissions, brainstorm sessions, BYO AI, Harper grammar
- [x] Drafted design doc: `docs/superpowers/specs/2026-10-31-canonball-app-design.md`
