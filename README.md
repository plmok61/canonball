# Canonball

A desktop writing app for fiction. You write the prose. The AI keeps your notes, answers questions about your story, and helps you brainstorm, but it never writes or edits your drafts.

Think of it as "Cursor for writers," with one inversion: in Cursor the AI writes the code. In Canonball the AI stays out of the prose.

> **Status: early development.** Phases 1 and 2 (the editor and writing aids) are done. The AI features are next. See the [roadmap](docs/superpowers/plans/2026-10-31-roadmap.md).

---

## What works today

- **Projects.** Open any folder of markdown files, or create a new project from the built-in template (File ▸ Open Project… ⌘O, New Project… ⇧⌘N).
- **Folder tree.** Your project's folders and files sit in the left column. Chapters sort naturally (chapter 10 comes after chapter 2).
- **A real word processor.** A page-style editor with bold, italics, headings, quotes, lists and scene breaks. You never see markdown syntax, but every file is saved as plain markdown, so your work stays portable and works with git.
- **Your files stay intact.** Opening a file never rewrites it. Template prompts (HTML comments) show as faint hints, and front matter, raw HTML and footnotes are preserved exactly.
- **Autosave.** Saves shortly after you stop typing. If a save fails, the status bar shows "not saved — retrying" and the app keeps trying. If anything is still unsaved when you quit, it asks before closing.
- **Spelling and grammar.** Chromium's spellchecker (right-click for suggestions) and offline grammar checking with [Harper](https://writewithharper.com). Click an underline to see the fix. Nothing changes until you pick one.
- **Light, Dark and Match System themes.** Dark mode is warm off-white on soft near-black, with contrast checked against WCAG AA.

## What's coming

| Phase | What it adds |
|---|---|
| 3. AI permissions | A badge on every folder and file: the AI can read and edit ✎, read only 👁, or can't see it ⊘. Prose folders can never be edited by the AI. |
| 4. AI connection & chat | A chat panel. Bring your own API key (Anthropic, OpenAI, Google) or point it at a local model (Ollama, LM Studio). Keys are stored in the macOS Keychain. |
| 5. AI notes & canon edits | The AI can propose changes to notes and canon, and every change is an Accept/Reject card. Nothing is changed silently. |
| 6. Brainstorm sessions | Goal-driven brainstorm threads that end with a session log and suggested canon updates. |
| 7. Release | A signed Mac build. |

Export to Word, EPUB and PDF is planned. The details will be decided after the app has been used for real writing.

---

## A Canonball project

New projects are created from [`template/`](template/), and existing folders open as they are.

| Folder | What goes here |
|---|---|
| `canon/` | The source of truth: characters, world, themes (including what the story must never do), timeline |
| `notes/` | Free brainstorming; may contradict canon until ideas are promoted |
| `outline/` | Chapter-by-chapter structure |
| `drafts/` | Your prose, by chapter, plus full-manuscript versions. **The AI never edits these.** |
| `sessions/` | Brainstorm session logs, so each session picks up where the last one left off |
| `memory/` | Your profile, tone notes, style rules and names to avoid, which shape how the AI talks to you |

[`examples/`](examples/) has a filled-in sample project (a robot on a trash planet) and example brainstorm prompts.

---

## Running it

Requires macOS and Node.js 22+.

```bash
npm install
npm run dev        # run the app with live reload
npm test           # run the test suite
npm run build:mac  # build Canonball.app and a .dmg into dist/
```

The Mac build isn't signed yet. The first time you open it, right-click the app and choose **Open**.

## Repository layout

| Path | Purpose |
|---|---|
| `src/main/` | Electron main process: files, project settings, window, menus |
| `src/preload/` | The safe bridge between the window and the filesystem |
| `src/renderer/` | The React UI: file tree, editor, themes |
| `src/shared/` | Types and helpers used by both sides |
| `template/` | The new-project scaffold |
| `docs/superpowers/` | Design spec, roadmap and phase plans |
| `docs/reference/` | AI-isms research behind the style rules |
| `OPEN_WORK.md` / `COMPLETED_WORK.md` | What's left and what's done |

Built with Electron, React, TypeScript, [TipTap](https://tiptap.dev) and Vitest.
