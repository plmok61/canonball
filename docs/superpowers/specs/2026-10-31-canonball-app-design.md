# Canonball — Desktop App Design

Date: 2026-10-31
Status: Draft for author review

## Intent

Canonball today is a folder scaffold (canon / notes / outline / drafts / sessions) that the author used with Cursor, where the AI ended up doing most of the writing. The app turns that scaffold into a dedicated desktop writing tool: "Cursor for writers," with one inversion. **The writer writes the prose. The AI keeps notes, answers questions, and helps brainstorm.**

It starts as the author's own tool and will be open-sourced for other writers. The name stays **Canonball**.

## Goals

- A three-panel desktop app: project folder tree (left), WYSIWYG word processor (center), AI chat (right).
- Writers never see or edit raw markdown. Files are saved as markdown on disk.
- The AI can read the project and edit notes/canon (and write session logs), but **never edits drafts**.
- The writer controls, per folder and per file, what the AI can see and edit, with visible badges in the tree.
- Bring-your-own AI: an API key for a cloud provider, or a URL for a model running on localhost.
- Keep the v1 brainstorming-session workflow, built into the app.
- Offline spelling and grammar checking that flags problems and leaves the fixes to the writer.
- Export to Word, EPUB, and PDF (after the first version; see Export).
- Dark mode as a first-class theme. This matters a lot to the author, because a white background makes it hard to work.

## Anti-goals (would make it a failure even if it works)

- The AI writing, rewriting, or autocompleting prose in drafts. There are no "continue writing," "rewrite selection," or ghost-text features, ever. (Prosemancer, the author's earlier VS Code extension, did exactly this. Canonball deliberately goes the other way.)
- The AI changing any file silently. Every AI edit is shown and accepted or rejected by the writer.
- A code-editor feel: visible markdown syntax, monospace prose, file extensions everywhere.
- API keys or project content passing through any server run by Canonball. The app talks directly to the provider the user chose.

## Non-goals for the first version

- Accounts, cloud sync, real-time collaboration.
- Windows and Linux builds. Electron makes them possible later, but Mac comes first.
- Built-in git integration. Files stay plain markdown, so users can use git themselves.

## How it gets made (decided)

- **Electron + React + TypeScript.** Chosen by the author over Tauri so they can edit the code themselves. It matches their other projects.
- **TipTap** (MIT-licensed open-source core) for the editor. Only free, open-source TipTap packages are used, with no TipTap Cloud or Pro extensions. If TipTap's markdown round-tripping proves inadequate, Milkdown is the fallback.
- **Spelling:** Electron's built-in Chromium spellchecker, using the macOS dictionaries.
- **Grammar/punctuation:** Harper (harper.js), running locally.

## The screen

A mockup was reviewed and approved in shape (`.superpowers/brainstorm/…/layout-v2-dark.html`).

**Left: project tree.** It shows the project's folders and files. Every folder and file has an AI-permission badge:

| Badge | Meaning |
|---|---|
| ✎ | AI can read and edit |
| 👁 | AI can read only |
| ⊘ | AI can't see it |

Clicking a badge cycles it. A file inherits its folder's setting unless it has its own override. A small legend sits at the bottom of the tree. Files are shown by name, without the `.md` extension.

**Center: editor.** A page-like WYSIWYG editor with a serif body font and a comfortable line length. The toolbar has bold, italic, headings, block quote, lists, and scene break (saved as a markdown horizontal rule). A status bar shows the file path, word count, and save state. Saving is automatic. When a draft is open, a banner says "Draft — AI won't edit." Spelling and grammar issues show as underlines, with suggestions on click or right-click.

**Non-prose markdown** *(Claude's call)*: YAML front matter is kept exactly as it is but hidden in the editor. HTML comments are kept exactly as they are and shown as faint, non-editable hint text, because the template files use them as fill-in guidance (e.g. "One sentence: job title, company…") and hiding them would leave a new project's canon files looking empty. Neither is editable in this version. Tables (TipTap's free table extension) and links can be both displayed and edited. The markdown round trip must never drop or rewrite content the editor doesn't understand.

**Right: AI chat.** It has a model picker at the top, the conversation, and an input box. When the AI wants to change a file, the change appears as an **Accept / Reject card** showing the file and the added and removed text. Nothing is written until the writer accepts.

**Theme.** Light, Dark, and Match System. The dark palette uses warm off-white text on a soft near-black, with no pure white or pure black (see the dark mockup).

## AI permissions

Defaults for a project (folder level):

| Folder | Default | Notes |
|---|---|---|
| `canon/` | read & edit | |
| `notes/` | read & edit | AI may create new files here |
| `outline/` | read only | |
| `drafts/` | read only | **Edit is never available**, a hard rule rather than a setting. Read access lets the AI answer continuity questions ("did I already say her eyes were grey?"). The writer can set drafts to ⊘. |
| `sessions/` | read & edit | Needed so the AI can write session logs |
| `memory/` | read only | Project memory and style rules (below) |

Permissions are stored in a settings file inside the project folder (e.g. `.canonball/project.json`), so they travel with the project.

The hard rule on drafts is enforced in the app's file-access layer, not just in the prompt. Even if a model tries, the app refuses any write to a prose folder.

**Prose folders** *(Claude's call)*. The no-AI-edit rule attaches to a folder marked as **prose**, not to a hard-coded path. `drafts/` is marked prose by default. In a project that doesn't follow the scaffold (prose in `manuscript/` or at the top level), the writer marks those folders as prose from the tree. A prose folder can be 👁 or ⊘ but never ✎.

**Unlisted folders and top-level files** *(Claude's call)*: these default to 👁 read-only. In a folder opened with no `.canonball/` settings, everything defaults to 👁, and the app asks once which folders hold prose.

**What ✎ allows** *(Claude's call)*. In a ✎ folder the AI may edit existing files and create new ones, `canon/` included. It may **not** delete, rename, or move files in this version. A file-level ✎ inside a 👁 folder lets the AI edit that file but not create files next to it. Every edit and every new file is an Accept/Reject card.

## Connecting the AI

- Settings has two kinds of connection:
  1. **Cloud provider with API key:** Anthropic, OpenAI, and Google to start.
  2. **Local server URL:** any OpenAI-compatible endpoint, e.g. Ollama at `http://localhost:11434` or LM Studio.
- The model is chosen from a dropdown in the chat panel.
- API keys are stored in the macOS Keychain (Electron `safeStorage` or equivalent), never in the project folder.
- The AI reaches files through tools the app provides (list files, read file, propose edit, create note), so whole projects aren't sent with every message. Only files whose permissions allow it are visible to these tools.
- For local models without tool-calling support, the app falls back to putting the readable files (or as many as fit) directly into the prompt, and edits come back as proposals the writer accepts.

## Brainstorm sessions (carried over from v1)

- The writer starts a session with a goal ("figure out what happens when the ship arrives"). Each session is its own chat thread.
- In a session the AI takes the v1 stance: it opens doors rather than closing them, offers several directions and argues for the ones it finds most interesting, asks questions that force the writer to commit, and doesn't resolve things prematurely. It reads the readable canon and notes before starting.
- When the writer ends the session, the AI drafts a log in `sessions/` using the existing template (Goals, Decisions Made, What Was Written, Open Questions, Next Session). The log arrives as an Accept/Reject card.
- The AI then offers to move locked-in decisions into `canon/`, one Accept/Reject card per change.
- A new session automatically reads the previous session's "Next Session" section.

**Where chats live** *(Claude's call)*. Chat threads, brainstorm transcripts included, are saved inside the project under `.canonball/chats/`, so reopening a project brings them back and they move with the folder. New projects get a `.gitignore` entry for `.canonball/chats/`, because transcripts can quote files later hidden with ⊘. The written session log in `sessions/` is the durable record.

## Style rules and names to avoid

- `memory/style_rules.md` is **kept**. The intended use is that the AI doesn't write prose, but some users will ask it for a sample passage in a note and then paste it into a draft. When that happens the AI is allowed to do it, **only into notes or chat, never drafts**, and must follow `style_rules.md`. The app includes the style rules in the AI's instructions whenever the file exists.
- `memory/names_to_avoid.md` is followed whenever the AI suggests names.
- `memory/user_profile.md` and `memory/feedback_tone.md` stay as readable project memory that shapes how the AI talks to the writer.
- `CLAUDE.md` (Cursor/Claude Code guidance) is not part of the new-project template. The app's own built-in instructions replace it.

## Projects

- **Open project:** opens any folder, including existing v1 Canonball projects as they are.
- **New project:** creates the scaffold (canon, notes, outline, drafts/chapters, drafts/full, sessions, memory with style_rules and names_to_avoid, plus the session template).
- The app works directly on plain markdown files. Nothing is locked into a proprietary format.

## Export

Word (.docx), EPUB, and PDF are wanted, but **deferred until after the first usable version**. The author wants to use the app before deciding what gets exported (the open file vs. a compiled book, and how the current draft per chapter is chosen) and how it should look (submission manuscript vs. reader-ready book). The first version ships without export, and nothing in it should rule export out. Tracked in `OPEN_WORK.md`.

## Left to the builder

- Repo layout. The app becomes the main thing in this repo, and the current scaffold becomes the new-project template inside it.
- Exact TipTap extensions and the markdown serializer, provided the round trip doesn't damage the writer's files.
- How provider APIs are called (direct SDKs or a common abstraction).
- The visual styling details beyond the mockups, the dark palette's warmth, and no pure white or black.
- Packaging and auto-update for macOS.
- Open-source license.
