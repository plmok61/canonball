# Canonball

A scaffold for writing short stories with AI. Copy this repo, fill in your canon, and start writing.

---

## How to Use This

### 1. Copy the scaffold

Duplicate this directory and give it your project's name. Everything here is a starting point — delete what you don't need.

### 2. Write a first-session prompt

Before opening your AI tool, write a short prompt that tells it your story idea, what you already know, and what you want help figuring out. See `examples/prompts/first-session.md` for a model to learn from.

A good first prompt covers: the core idea, the central theme, any decisions you've already made, and the open questions you want help working through. Then paste your prompt into your AI tool of choice (Claude Code, Cursor, ChatGPT, Codex) and start the conversation.

Don't skip this step. Writing before canon exists leads to drift.

### 3. Build canon before prose

The `canon/` folder is the single source of truth for your story. Fill in all four files before writing your first draft:

| File | What goes here |
|------|---------------|
| `canon/characters.md` | Who your characters are, how they think, what they want |
| `canon/world.md` | Setting, rules, physical and social reality of the story |
| `canon/themes.md` | What the story is about — and what it must never do |
| `canon/timeline.md` | The sequence of events, including unresolved open questions |

See `examples/canon/` for a filled-in example based on a short story about a robot on a trash planet.

### 4. Use notes freely

`notes/` is for raw brainstorming. It can contradict canon. It doesn't need to be consistent. When an idea solidifies, promote it into the relevant canon file.

### 5. Write drafts in chapters

`drafts/chapters/` organizes prose by chapter number. Name versions clearly within each folder — `draft1.md`, `draft2.md`, `draft2-author.md` for anything you write yourself.

### 6. Write a session prompt to resume work

Most AI tools have no memory of your last conversation. Each time you start a new session, write a short prompt that restores context — what the story is, where you left off, and what you want to do today. See `examples/prompts/brainstorm-ship-arrival.md` for an example of what a mid-story session prompt looks like.

At the end of each session, create a log in `sessions/` using the template. Record what was decided, what was written, and where to pick up next time — this becomes the source material for your next session prompt.

---

## Project Layout

| Path | Purpose |
|------|---------|
| `canon/` | Authoritative story facts — characters, world, themes, timeline |
| `notes/` | Exploratory brainstorming (may contradict canon) |
| `outline/` | Chapter-by-chapter narrative structure |
| `drafts/` | Prose drafts organized by chapter and full manuscript versions |
| `sessions/` | Per-session logs for continuity across AI conversations |
| `memory/` | AI session memory — author profile and tone notes |
| `examples/` | Example canon files and starter prompts |

---

## Example Prompts

These are models to learn from, not templates to fill in. Read them to understand the structure and tone, then write your own.

| Prompt | What it demonstrates |
|--------|---------------------|
| `examples/prompts/first-session.md` | How to kick off a new story — stating the idea, the theme, what's settled, and what's open |
| `examples/prompts/brainstorm-ship-arrival.md` | How to run a mid-story brainstorm — giving context, naming constraints, asking specific questions |
